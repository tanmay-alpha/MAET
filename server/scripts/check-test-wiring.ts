/**
 * Fails when a tracked *.test.ts file would not run under `bun run test:all`
 * (which CI runs as test:unit + test:integration + test:concurrency +
 * test:advanced), or when a `bun test` filter in that chain matches nothing.
 *
 * `bun test <filter>` runs every test file whose path contains the filter, so
 * this mirrors that substring rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT_SCRIPT = "test:all";
const repoRoot = join(import.meta.dir, "../..");
const scripts: Record<string, string> = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts;

function collectFilters(scriptName: string, seen = new Set<string>()): string[] {
  const command = scripts[scriptName];
  if (command === undefined) throw new Error(`package.json script "${scriptName}" does not exist`);
  if (seen.has(scriptName)) return [];
  seen.add(scriptName);

  return command.split("&&").flatMap((segment) => {
    const [bin, sub, ...args] = segment.trim().split(/\s+/u);
    if (bin !== "bun") return [];
    if (sub === "run") return collectFilters(args[0]!, seen);
    if (sub === "test") return args.filter((arg) => !arg.startsWith("-"));
    return [];
  });
}

const listed = Bun.spawnSync(["git", "ls-files", "*.test.ts"], { cwd: repoRoot });
if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr.toString()}`);
const testFiles = listed.stdout.toString().split("\n").map((line) => line.trim()).filter(Boolean);

const filters = collectFilters(ROOT_SCRIPT);
const unwired = testFiles.filter((file) => !filters.some((filter) => file.includes(filter)));
const deadFilters = filters.filter((filter) => !testFiles.some((file) => file.includes(filter)));

if (unwired.length > 0) {
  console.error(`Test files not run by \`bun run ${ROOT_SCRIPT}\`:\n  ${unwired.join("\n  ")}`);
}
if (deadFilters.length > 0) {
  console.error(`\`bun test\` filters that match no tracked test file:\n  ${deadFilters.join("\n  ")}`);
}
if (unwired.length > 0 || deadFilters.length > 0) process.exit(1);
console.log(`All ${testFiles.length} tracked test files are wired into ${ROOT_SCRIPT}.`);
