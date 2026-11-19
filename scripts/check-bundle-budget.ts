/**
 * Initial-JS budget for the production frontend build.
 *
 *   bun run build && bun run check:bundle            # fail if the landing route grew > 10 %
 *   bun run check:bundle --update                    # record the current build as the new baseline
 *
 * "Initial JS" for a route is what the browser must fetch before the route renders: the
 * `preloads` and entry `scripts` TanStack Start lists for the route and every ancestor route
 * (root, layouts) in its start manifest, plus the static-import closure of those chunks.
 * Chunks reached only through `import()` (React.lazy, route splitting) are reported as lazy JS
 * and never count against the budget. Sizes are gzip bytes, which is what the CDN serves.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "bun";

type ManifestRoute = {
  children?: string[];
  preloads?: string[];
  scripts?: { attrs?: { src?: string } }[];
};
type Manifest = { routes: Record<string, ManifestRoute> };
type Budget = { route: string; initialJsGzipBytes: number; tolerance: number };
type Size = { files: number; raw: number; gzip: number };

const repoRoot = join(import.meta.dir, "..");
const budgetFile = join(import.meta.dir, "bundle-budget.json");
const ROOT_ID = "__root__";
const REPORTED_ROUTES: [label: string, id: string][] = [
  ["entry (root)", ROOT_ID],
  ["landing /", "/"],
  ["screener", "/_app/screener"],
  ["stock/$symbol", "/_app/stock/$symbol"],
  ["chart/$symbol", "/_app/chart/$symbol"],
  ["terminal", "/_app/terminal"],
  ["portfolio", "/_app/portfolio"],
  ["compare", "/_app/compare"],
  ["payoff", "/_app/payoff"],
  ["world", "/_app/world"],
];

// The Vercel preset (`bun run build`, CI) and the node-server preset (`bun run --cwd src preview`)
// write different layouts; check whichever build is newest.
const OUTPUTS = [
  { server: "src/.vercel/output/functions/__server.func", static: "src/.vercel/output/static" },
  { server: "src/.output/server", static: "src/.output/public" },
];

function findBuild(): { manifestFile: string; staticDir: string } {
  const found = OUTPUTS.flatMap((output) => {
    const serverDir = join(repoRoot, output.server);
    if (!existsSync(serverDir)) return [];
    return [...new Bun.Glob("**/_tanstack-start-manifest_v-*.mjs").scanSync({ cwd: serverDir })].map((file) => {
      const manifestFile = join(serverDir, file);
      return { manifestFile, staticDir: join(repoRoot, output.static), mtime: statSync(manifestFile).mtimeMs };
    });
  });
  if (found.length === 0) {
    console.error("No TanStack Start manifest found. Run `bun run build` first.");
    process.exit(2);
  }
  return found.sort((a, b) => b.mtime - a.mtime)[0]!;
}

// Rolldown writes specifiers with any quote style, including template literals.
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'`();]*?\bfrom\s*)?["'`](\.\/[^"'`]+?\.js)["'`]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'`](\.\/[^"'`]+?\.js)["'`]\s*\)/g;

const { manifestFile, staticDir } = findBuild();
// The manifest file name carries a content hash, so it can only be imported once found on disk.
const { tsrStartManifest } = (await import(pathToFileURL(manifestFile).href)) as { tsrStartManifest: () => Manifest };
const routes = tsrStartManifest().routes;

const parents = new Map<string, string>();
for (const [id, route] of Object.entries(routes)) {
  for (const child of route.children ?? []) parents.set(child, id);
}

const sources = new Map<string, string>();
function source(asset: string): string {
  let code = sources.get(asset);
  if (code === undefined) {
    const file = join(staticDir, asset);
    if (!existsSync(file)) throw new Error(`Manifest lists ${asset}, but ${relative(repoRoot, file)} does not exist`);
    code = readFileSync(file, "utf8");
    sources.set(asset, code);
  }
  return code;
}

function imports(asset: string, pattern: RegExp): string[] {
  const dir = asset.slice(0, asset.lastIndexOf("/") + 1);
  return [...source(asset).matchAll(pattern)].map((match) => dir + match[1]!.slice(2));
}

function staticClosure(roots: Iterable<string>, into = new Set<string>()): Set<string> {
  const stack = [...roots];
  while (stack.length > 0) {
    const asset = stack.pop()!;
    if (into.has(asset)) continue;
    into.add(asset);
    stack.push(...imports(asset, STATIC_IMPORT));
  }
  return into;
}

function ownAssets(id: string): string[] {
  const route = routes[id];
  if (!route) throw new Error(`Route ${id} is not in the start manifest`);
  const scripts = (route.scripts ?? []).flatMap((script) => (script.attrs?.src ? [script.attrs.src] : []));
  return [...scripts, ...(route.preloads ?? [])].filter((asset) => asset.endsWith(".js"));
}

function initialAssets(id: string): Set<string> {
  const chain: string[] = [];
  for (let current: string | undefined = id; current; current = parents.get(current)) chain.push(current);
  return staticClosure(chain.flatMap(ownAssets));
}

/**
 * Chunks a route loads through `import()` from its own chunks, minus what is already initial.
 * Ancestor chunks are skipped: the entry chunk lazily imports every route.
 */
function lazyAssets(id: string, initial: Set<string>): Set<string> {
  const parent = parents.get(id);
  if (parent === undefined) return new Set();
  const inherited = initialAssets(parent);
  const own = [...staticClosure(ownAssets(id))].filter((asset) => !inherited.has(asset));
  const lazy = staticClosure(own.flatMap((asset) => imports(asset, DYNAMIC_IMPORT)));
  for (const asset of initial) lazy.delete(asset);
  return lazy;
}

const gzipSizes = new Map<string, number>();
function measure(assets: Set<string>): Size {
  let raw = 0;
  let gzip = 0;
  for (const asset of assets) {
    const code = source(asset);
    raw += Buffer.byteLength(code);
    let compressed = gzipSizes.get(asset);
    if (compressed === undefined) {
      compressed = gzipSync(code).byteLength;
      gzipSizes.set(asset, compressed);
    }
    gzip += compressed;
  }
  return { files: assets.size, raw, gzip };
}

// 1 kB = 1000 bytes, as in Vite's build report.
const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

console.log(`Build: ${relative(repoRoot, manifestFile)}\n`);
console.log("| Route | Initial JS files | Initial JS raw | Initial JS gzip | Lazy JS gzip |");
console.log("|---|---:|---:|---:|---:|");
for (const [label, id] of REPORTED_ROUTES) {
  if (!routes[id]) continue;
  const initial = initialAssets(id);
  const size = measure(initial);
  const lazy = measure(lazyAssets(id, initial));
  console.log(`| ${label} | ${size.files} | ${kb(size.raw)} | ${kb(size.gzip)} | ${lazy.files ? kb(lazy.gzip) : "—"} |`);
}

const budget: Budget = JSON.parse(readFileSync(budgetFile, "utf8"));
const current = measure(initialAssets(budget.route)).gzip;

if (process.argv.includes("--update")) {
  writeFileSync(budgetFile, `${JSON.stringify({ ...budget, initialJsGzipBytes: current }, null, 2)}\n`);
  console.log(`\nBaseline for ${budget.route} set to ${current} gzip bytes (${kb(current)}).`);
  process.exit(0);
}

const limit = Math.floor(budget.initialJsGzipBytes * (1 + budget.tolerance));
const growth = ((current / budget.initialJsGzipBytes - 1) * 100).toFixed(1);
const summary = `${budget.route} initial JS: ${current} gzip bytes (${kb(current)}), baseline ${budget.initialJsGzipBytes}, limit ${limit} (+${budget.tolerance * 100}%), change ${growth}%`;
if (current > limit) {
  console.error(`\nBundle budget exceeded. ${summary}`);
  console.error("Lazy-load the new dependency, or run `bun run check:bundle --update` if the growth is intended.");
  process.exit(1);
}
console.log(`\nWithin budget. ${summary}`);
