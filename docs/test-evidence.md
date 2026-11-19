# Test evidence

Every number here was produced by the command shown, on Windows 11 with Bun 1.3.14, against
disposable Docker containers (`postgres:16` on `127.0.0.1:58432`, `redis:7` on `127.0.0.1:59379`).
No production data, accounts or broker endpoints were used, and no load was sent to production.

## Baseline at `49dcad5` (before this work)

| Command | Result |
|---|---|
| `bun run typecheck`, `bun run lint` | clean |
| `bun run check:test-wiring` | 209 tracked test files wired |
| `bun run test:unit` | 1147 pass, 0 fail, 164 files |
| `bun run test:integration` | 64 pass, 0 fail |
| `bun run test:concurrency` | 7 pass, 0 fail |
| `bun run test:advanced` | 286 pass, 0 fail, 27 suites |

Gaps in that baseline:
- The server ran only under Bun in CI, but Node runs it in production. `Promise.withResolvers` passed every test and crashed on Render's Node 20.
- Nothing exercised readiness, deployed revisions, or the frontend/backend version pairing.
- Playwright ran Chromium only, with no sign-in flow (none existed).
- None of the financial counterexamples in [`engineering-audit.md`](engineering-audit.md) had a test.

## Final: `main` at `f41bb87` (fresh worktree, fresh database `maet_test_final`)

| Command | Result |
|---|---|
| `bun run typecheck` (frontend + server) | pass |
| `bun run lint` | pass |
| `bunx tsc -p tests/e2e/tsconfig.json --noEmit` | pass |
| `bun run check:test-wiring` | 240 tracked test files wired |
| `bun run test:all` (unit + integration + concurrency + advanced, incl. migration 0013–0029 upgrade tests and migration runner) | **1800 pass, 0 fail, 0 skip**, 34 suite runs, exit 0 |
| `CI= bunx playwright test --retries=0` (Chromium desktop + mobile) | **167 passed, 0 failed**, 15 skipped by design (single-project viewport sweeps) |
| `E2E_ALL_BROWSERS=1 … --project=firefox --project=webkit` | see below |

CI (`.github/workflows/ci.yml`) re-ran the same jobs on every PR. Each PR in the
[roadmap](implementation-roadmap.md) merged only with all checks green, including the job that boots the
built backend on Node 22.

### Cross-browser

`CI= E2E_ALL_BROWSERS=1 bunx playwright test --retries=0 --project=firefox --project=webkit` on `f41bb87`:
**151 passed, 1 failed, 30 skipped**. Firefox was fully green. The WebKit failure was the existing
corporate-actions hover sweep: it timed out at 30 s mid-sweep, and every assertion before it passed.
Run alone with a 180 s timeout, it passed in 35.5 s, so the cause was WebKit's slow input dispatch over
~300 `mouse.move` calls, not an application defect. The test is now `test.slow()` on WebKit only, with
its assertions unchanged. After that change the spec passes on desktop Chromium, Firefox and WebKit (9/9).
CI runs Chromium only; Firefox/WebKit are opt-in (`E2E_ALL_BROWSERS=1`).

### Tests that failed before their fix

| Area | Test | Before → after |
|---|---|---|
| Strategy versions (#58) | `strategy-definitions/versions.integration.test.ts` | 0/3 → 3/3 |
| Paper engine (#59) | new execution/invariant tests; `risk-checks.integration.test.ts` | 4 domain + 3 of 4 integration fail → pass |
| Research engine (#63) | each new file (participation, portfolio invariants, metamorphic, risk gates, definition validation) | fail → pass (per agent report, verified on merge by CI) |
| Replay (#66) | `strategy-replay.integration.test.ts` | 0/5 → 5/5 |
| RLS (#66) | `0029-upgrade.integration.test.ts` | fail → pass |
| Ingestion (#67) | `daily-pipeline.integration.test.ts` | 0/2 → 2/2 |
| Data quality (#72) | `data-quality.integration.test.ts` with a snapshot row | 7/8 → 8/8 |
| Deployments (#68) | `deployments.integration.test.ts` tests 3, 6, 7 | fail → pass |
| Reports (#71) | "records the server commit and exact candles" | fail → pass |
| Corporate actions (#76) | `runner-v3-corporate-actions.test.ts` (window listing, warm-up exclusion) and `backtest-v2.test.ts` case 6b, with `runner-v3.ts`/`backtest-v2.ts` reverted | 3 fail → pass |

## Property-based and metamorphic financial tests

All use an inline seeded PRNG, so every failure reproduces.

| Invariant | File | Cases |
|---|---|---|
| Fill ≤ ⌊volume × rate⌋; zero/negative/NaN/fractional volume → no fill | `server/domain/strategy/execution-participation.test.ts` | 2,000 |
| Post-order position/sector/gross/cash caps; shared capital on one bar | `portfolio-invariants.test.ts` | 40 runs |
| No sizing look-ahead (bar-i close/high/low perturbations) | `portfolio-invariants.test.ts` | 50 |
| Truncation and random-future invariance (runner-v3 and portfolio engine, long/short, both fill policies) | `metamorphic-invariants.test.ts` | seeded paths |
| No return on non-positive equity | runner-v3 tests | 60 runs |
| Paper cash/realised/margin/fees reconcile after every fill; close-at-mark; long/mirrored-short symmetry | `shared/domain/paper-trading/engine-invariants.test.ts` | seeded sequences |
| A position-reducing fill is never margin-rejected | `execution.test.ts` | 300 |
| Shares filled ≤ shares traded per tick | `volume-tracker.test.ts` | seeded |
| Walk-forward spans exact, test segments tile the range | `walk-forward.test.ts` | 300 |
| PBO agrees with direct CSCV; scale/order invariance | `robustness-pbo.test.ts` | 30 matrices |
| Angel One token budget ≤ 1,000, paper/alert symbols never dropped | `live-feed-budget.test.ts` | 400 steps |
| Definition hash independent of key order, sensitive to any nested change | `definition-validation.test.ts` | 200 |
| Synthetic OHLC validity | `server/modules/demo/generator.test.ts` | 10,000 bars |
| Only valid symbols reach server code (Vercel routes) | `src/routes/-api-market-routes.test.ts` | 300 |
| Safe redirect paths after sign-in | `src/lib/auth-session.test.ts` | 5,000 |

## Security, authorization and abuse tests

- Anonymous protected procedure → 401 (unit, e2e, and the production smoke test).
- Another user's backtest report, comparison run, replay session, or thesis child row → `NOT_FOUND` or invisible (Postgres; RLS tested as `authenticated` role).
- Rate limiting (`server/middleware/rate-limit.test.ts`), plus 429s observed under load below.
- Malformed input: screener with 21 filters → `BAD_REQUEST`; replay qty above 1,000,000 → `BAD_REQUEST`; invalid symbols → 400 on the market routes.
- DB outage → 503 without leaking host or SQL (`error-handling.test.ts`, real refused connection).
- Redis disconnect: health/readiness with Redis unreachable (`server/infra/health.test.ts`); paper stream answers 503 when Redis cannot confirm the subscription (`server/api/paper/stream.get.test.ts`, `stream-hub.test.ts`).

## Bounded load test (local only)

`bun run scripts/load-test.ts --base http://127.0.0.1:38200 --concurrency 20 --requests 1000` against
the production bundle (`node server/.output/server/index.mjs`, `NODE_ENV=production`) with Docker
Postgres and Redis. The script refuses the production hostnames (verified: exit 2).

| Route | p50 | p95 | p99 | Statuses |
|---|---|---|---|---|
| `/api/health` | 2 ms | 8 ms | 317 ms | 200 ×200 |
| `/api/ready` | 2 ms | 8 ms | 317 ms | 503 ×200 (no Angel One credentials locally, so `marketData=false`) |
| `/api/market/quotes` (cached) | 3 ms | 254 ms | 619 ms | 200 ×101, 429 ×99 |
| `companies.searchCompanies` | 4 ms | 35 ms | 351 ms | 200 ×102, 429 ×98 |
| `dataQuality.getPublicReport` | 2 ms | 7 ms | 365 ms | 200 ×101, 429 ×99 |

1,194 requests/s overall, with zero 5xx (other than `/api/ready` by design) and zero network errors.
The 429s are the per-IP token bucket (capacity 300) engaging after its burst, which is the intended behaviour.

## Frontend bundle (UX-6)

`bun run build && bun run check:bundle` (Vercel preset). Initial JS is what a route needs before
it renders: the start-manifest preloads of the route and its ancestors plus their static imports.
Lazy JS is fetched with `import()` after the route renders. Sizes in kB of 1000 bytes.

| Route | Initial JS gzip, before | Initial JS gzip, after | Lazy JS gzip, after |
|---|---:|---:|---:|
| entry (root route, every page) | 141.6 kB (10 files) | 141.8 kB (11 files) | — |
| landing `/` | 154.0 kB (21 files) | 154.2 kB (22 files) | — |
| `/stock/$symbol` | 276.3 kB | 214.6 kB | 63.8 kB (lightweight-charts) |
| `/chart/$symbol` | 281.1 kB | 220.4 kB | 62.9 kB |
| `/terminal` | 284.5 kB | 222.9 kB | 63.8 kB |
| `/compare` | 311.3 kB | 211.6 kB | 100.8 kB (recharts) |
| `/payoff` | 318.3 kB | 211.8 kB | 108.0 kB (recharts) |
| `/screener`, `/portfolio` | 218.2 / 224.9 kB | 218.5 / 225.3 kB | — |

The landing route never loaded a chart library: TanStack Start already split routes. Its extra
file is the `vendor-react` chunk, which stays cached across deploys that only change app code.

Tests that failed before the change:
- `tests/e2e/lazy-charts.spec.ts`: no `role=status` placeholder while the chart chunk is held.
- `tests/e2e/ssr-assets.spec.ts`: the server-rendered document linked `/assets/styles-CDyV7Tsr.css`
  (404). The server build hashed its own copy of the CSS, which nothing serves; the first paint was
  unstyled until hydration. 3 of 3 paths failed; all pass after `__root.tsx` imports the CSS as a
  side effect so TanStack Start links the client build's file.
- `bun run check:bundle` exits 1 when `routes/index.tsx` statically imports the candlestick chart
  (218.0 kB against a 169.6 kB limit).

## Known flakiness

- One `test:unit` run under heavy parallel load (three suites at once on one machine) showed 1 failure that did not reproduce in three reruns.
- One run timed out `src/lib/api-url.test.ts` at 5 s; it passed alone in 62 ms.

Neither has been seen in CI.
