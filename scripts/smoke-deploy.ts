/**
 * Post-deploy smoke test for the deployed MAET frontend and backend.
 *
 *   bun run scripts/smoke-deploy.ts --sha <commit> [--backend URL] [--frontend URL] [--backend-only]
 *
 * Read-only: every request is a GET/HEAD/OPTIONS that neither writes data nor
 * spends broker quota. Exits non-zero, listing each failed check, when:
 * - backend readiness (/api/ready) is not 200 or reports another commit,
 * - the frontend alias serves a different commit (x-maet-build header),
 * - the browser origin is not allowed by backend CORS,
 * - a protected procedure answers anonymous callers (auth boundary),
 * - a public database-backed procedure or the quotes API fails.
 */

type Check = { name: string; ok: boolean; detail: string };

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const expectedSha = arg("sha", process.env.EXPECTED_SHA);
const backend = (arg("backend", "https://maet.onrender.com") ?? "").replace(/\/+$/, "");
const frontend = (arg("frontend", "https://maet-pi.vercel.app") ?? "").replace(/\/+$/, "");
const frontendOrigin = new URL(frontend).origin;
// The backend and frontend deploy independently; --backend-only skips the frontend revision check.
const backendOnly = process.argv.includes("--backend-only");

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: "manual" });
}

async function run(name: string, fn: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function expectSha(observed: string | null | undefined, what: string): string {
  if (!expectedSha) return `${what} serves ${observed ?? "unknown"} (no --sha given)`;
  if (observed !== expectedSha) throw new Error(`${what} serves ${observed ?? "unknown"}, expected ${expectedSha}`);
  return `${what} serves ${expectedSha.slice(0, 7)}`;
}

const checks = await Promise.all([
  run("backend readiness", async () => {
    const res = await request(`${backend}/api/ready`);
    const body = (await res.json()) as { status?: string; version?: string; checks?: Record<string, boolean> };
    if (res.status !== 200) {
      const down = Object.entries(body.checks ?? {}).filter(([, ok]) => !ok).map(([name]) => name);
      throw new Error(`HTTP ${res.status} status=${body.status} failing=[${down.join(", ")}]`);
    }
    return expectSha(body.version, "backend");
  }),
  run("frontend revision", async () => {
    if (backendOnly) return "skipped (--backend-only)";
    const res = await request(`${frontend}/`, { method: "HEAD" });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return expectSha(res.headers.get("x-maet-build"), "frontend");
  }),
  run("CORS preflight from the frontend origin", async () => {
    const res = await request(`${backend}/api/trpc/companies.searchCompanies`, {
      method: "OPTIONS",
      headers: { origin: frontendOrigin, "access-control-request-method": "GET" },
    });
    const allowed = res.headers.get("access-control-allow-origin");
    if (allowed !== frontendOrigin) throw new Error(`allow-origin=${allowed ?? "none"} (HTTP ${res.status})`);
    return `allows ${frontendOrigin}`;
  }),
  run("auth boundary on paperTrading.getState", async () => {
    const res = await request(`${backend}/api/trpc/paperTrading.getState`);
    if (res.status !== 401) throw new Error(`anonymous call answered HTTP ${res.status}, expected 401`);
    return "anonymous call rejected with 401";
  }),
  run("public DB-backed query companies.searchCompanies", async () => {
    const input = encodeURIComponent(JSON.stringify({ query: "REL" }));
    const res = await request(`${backend}/api/trpc/companies.searchCompanies?input=${input}`);
    const body = (await res.json()) as { result?: { data?: unknown } };
    if (res.status !== 200 || !Array.isArray(body.result?.data)) throw new Error(`HTTP ${res.status}`);
    return `HTTP 200, ${body.result.data.length} rows`;
  }),
  run("quotes API", async () => {
    const res = await request(`${backend}/api/market/quotes?symbols=RELIANCE`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return `HTTP 200, keys=${Object.keys(body).join(",")}`;
  }),
]);

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
const failed = checks.filter((check) => !check.ok).length;
console.log(`${checks.length - failed}/${checks.length} smoke checks passed`);
process.exit(failed === 0 ? 0 : 1);
