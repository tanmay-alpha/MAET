/**
 * Bounded read-only load test for a LOCAL or staging backend.
 *
 *   bun run scripts/load-test.ts --base http://127.0.0.1:3000 [--concurrency 20] [--requests 400]
 *
 * Refuses the production hosts. Sends a fixed number of GET requests (no writes, no broker
 * quota: quotes are served from cache because refresh=1 is never sent) across a mix of public
 * routes, then prints per-route latency percentiles, status counts and throughput. Exits 1 if
 * any request fails with a 5xx or a network error, or if a route's p95 exceeds --p95-budget-ms.
 */

const PRODUCTION_HOSTS: Record<string, true> = { "maet.onrender.com": true, "maet-pi.vercel.app": true };

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const base = arg("base", "http://127.0.0.1:3000").replace(/\/+$/, "");
const concurrency = Math.max(1, Number(arg("concurrency", "20")));
const total = Math.max(1, Number(arg("requests", "400")));
const p95BudgetMs = Number(arg("p95-budget-ms", "1000"));

if (PRODUCTION_HOSTS[new URL(base).hostname]) {
  console.error(`Refusing to load-test production (${base}). Point --base at a local or staging backend.`);
  process.exit(2);
}

const searchInput = encodeURIComponent(JSON.stringify({ query: "REL" }));
const ROUTES = [
  { name: "health", path: "/api/health" },
  { name: "ready", path: "/api/ready" },
  { name: "quotes (cached)", path: "/api/market/quotes?symbols=RELIANCE,TCS,INFY" },
  { name: "companies.searchCompanies", path: `/api/trpc/companies.searchCompanies?input=${searchInput}` },
  { name: "dataQuality.getPublicReport", path: "/api/trpc/dataQuality.getPublicReport" },
];

type Sample = { route: string; status: number; ms: number };
const samples: Sample[] = [];
let next = 0;

async function worker(): Promise<void> {
  while (next < total) {
    const route = ROUTES[next++ % ROUTES.length]!;
    const started = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${base}${route.path}`, { signal: AbortSignal.timeout(15_000) });
      await res.arrayBuffer();
      status = res.status;
    } catch {
      status = 0;
    }
    samples.push({ route: route.name, status, ms: performance.now() - started });
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsedS = (performance.now() - startedAt) / 1000;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
let failed = false;
console.log(`${samples.length} requests, concurrency ${concurrency}, ${(samples.length / elapsedS).toFixed(1)} req/s against ${base}`);
for (const route of ROUTES) {
  const rows = samples.filter((s) => s.route === route.name);
  const latencies = rows.map((s) => s.ms).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const row of rows) statuses[row.status || "network-error"] = (statuses[row.status || "network-error"] ?? 0) + 1;
  // /api/ready answers 503 by design while a dependency is down; that is a result, not a failure.
  const errors = rows.filter((s) => s.status === 0 || (s.status >= 500 && route.name !== "ready")).length;
  const p95 = percentile(latencies, 95);
  const overBudget = p95 > p95BudgetMs;
  if (errors > 0 || overBudget) failed = true;
  console.log(
    `${errors > 0 || overBudget ? "FAIL" : "ok  "}  ${route.name.padEnd(28)} p50 ${percentile(latencies, 50).toFixed(0).padStart(5)} ms  p95 ${p95.toFixed(0).padStart(5)} ms  p99 ${percentile(latencies, 99).toFixed(0).padStart(5)} ms  ${JSON.stringify(statuses)}`,
  );
}
process.exit(failed ? 1 : 0);
