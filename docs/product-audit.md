# Local full-stack product audit

Date: 2026-11-19. Baseline: `a5fff98`; final verification incorporates UI polish PR #74 and route/CSS fixes PR #75 from `origin/main`.

## Environment and limits

The product was exercised in omp's managed **headless Chromium**, not the user's browser. The initial pass visited all **25 sidebar routes at 360, 768 and 1440 CSS px** (900 px high). Each visit captured a full-page screenshot, body text, console errors, HTTP failures and document overflow. The full 75-screenshot collection and JSON observations remain ignored local artifacts under `test-results/journey/`; only seven compressed finding images are retained in `docs/product-audit/`.

The frontend and backend were real production builds, not the Playwright mock API:

- Existing shared `maet-pg` and `maet-redis` containers, never recreated; dedicated database `maet_test_journey` on `127.0.0.1:58432`, Redis on `127.0.0.1:59379`.
- All 29 migrations applied; `MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:58432/maet_test_journey bun run seed:demo` created eight synthetic companies, 1,728 daily candles, eight quote snapshots, four paper fills, three positions and one completed eight-trade backtest.
- Backend: `bun run --cwd server build`, then `node server/.output/server/index.mjs`, `NODE_ENV=production PORT=3900 MAET_DEMO_MODE=1 STRATEGY_JOBS_IN_PROCESS=true`, the dedicated `SUPABASE_DB_URL`, shared `UPSTASH_REDIS_URL`, dummy Supabase/Angel values from `.env.test`, and `FRONTEND_ORIGIN=http://127.0.0.1:4441`.
- Frontend: `VITE_API_URL=http://127.0.0.1:3900 VITE_MAET_DEMO_MODE=1 VITE_SUPABASE_URL=https://x.supabase.co VITE_SUPABASE_ANON_KEY=test-anon-key bun run --cwd src preview --port 4441`. The existing preview script builds production assets with the Node server preset and serves them with Node.
- CORS was verified in Chromium: real quote responses included `access-control-allow-origin: http://127.0.0.1:4441`; the browser rendered those prices.
- The backend's normal daily processor also ran and fetched real NSE/Yahoo data during the audit. Demo mode does **not** replace real symbols with generated prices. Only explicitly synthetic seeded observations are synthetic; Yahoo observations remain delayed market data.

**Authentication coverage is signed-out only.** `server/api/trpc/auth.ts` verifies every supplied JWT using remote Supabase JWKS, issuer and audience checks. Its only test hook resets the key cache; there is no local/test verification bypass. No real Supabase credentials or signing keys were available. Production auth was not modified, fake sessions were not injected into the real browser journey, and the seeded user's private portfolio, fills, saved screens and reports were not accessed through the browser. Their absence while signed out is correct, not an empty-data defect. Real Postgres regression tests exercise the seeded public read paths; Playwright regressions use the repository's mock API.

## Findings

| ID | Page | Viewport | Issue and evidence | Evidence screenshot | Severity | Fixed? PR |
|---|---|---|---|---|---|---|
| J-1 | Every route | 360 / 768 / 1440 | SSR linked `/assets/styles-o5DUB8NI.css` (404); hydration later loaded the differently hashed client CSS (200). This caused an unstyled first render and a failed stylesheet request on every visit. | [Screener](product-audit/screener-1440.webp); local JSON HTTP evidence | P1 | Fixed by BundleSplit [PR #75](https://github.com/tanmay-alpha/maet/pull/75), with SSR-asset regressions. Baseline image retains the failure state. |
| J-2 | Screener; seeded-symbol quote consumer | 360 / 768 / 1440 | All eight seeded screener rows initially had empty price/change/volume columns despite persisted quote snapshots. The unfiltered company query skipped snapshots; the public quote service sent fictitious `DEMO-*` symbols to Yahoo and returned no quotes. | [Phone](product-audit/screener-360.webp), [seeded rows](product-audit/seeded-screener-missing-prices-1440.webp) | P1 | Yes — [PR #77](https://github.com/tanmay-alpha/MAET/pull/77). Company pages include stored observations; demo mode reads only explicitly synthetic company/snapshot rows. Original timestamps and `source=simulated`, `quality=synthetic`, `delayed=true` are preserved. |
| J-3 | Sidebar → Experimental | 360 / 768 / 1440 | The disclosure was an `onClick` div with `tabIndex=-1`, no button role or expanded state. Tab from Settings skipped it to Sign in, leaving eight routes unreachable by keyboard. | [Skipped disclosure](product-audit/experimental-keyboard-skipped-1440.webp); local keyboard observations | P2 | Yes — [PR #77](https://github.com/tanmay-alpha/MAET/pull/77). Native button, expanded state, controlled navigation region; Enter/Space and sheet Escape/focus-return regressions at all three widths. |
| J-4 | Watchlists, Compare, Universe, Data Status; quote labels | 360 / 768 / 1440 | Actual Yahoo observations were labelled “Synthetic demo data · not market data” solely because the build was in demo mode. Source provenance must follow the observation, not a deployment flag. Stored screener fallback prices also need their own provenance rather than the aggregate response label. | [Watchlist labels](product-audit/watchlists-768.webp) | P1 | Fixed by UiPolish [PR #74](https://github.com/tanmay-alpha/maet/pull/74). PR #77 uses [PR #86](https://github.com/tanmay-alpha/MAET/pull/86)'s canonical source/as-of header or per-row provenance column for explicit synthetic/delayed labels and stale tags. Numeric price cells remain unit-labelled numbers only; fresh public quotes take precedence over stored prices. |
| J-5 | Backend daily candle retention | All; server-side | The real daily processor logged `Buffer.byteLength` rejecting a `Date` interpolated into raw SQL. Cleanup silently retained expired candles. The new Postgres test first left both its year-2000 and current candle instead of deleting the old one. | [Associated storage report](product-audit/data-quality-1440.webp); failure reproduced by `journey.integration.test.ts` | P2 | Yes — [PR #77](https://github.com/tanmay-alpha/MAET/pull/77). Typed Drizzle `lt(candles.ts, cutoff)` supplies the timestamp encoder. A compiler-assisted sweep of raw tagged SQL in `server/` and `shared/` found no other remaining runtime Date interpolation; the other Date-bearing expressions were typed column references. |
| J-6 | Mobile/tablet sidebar | 360 / 768 | Escape closed the sheet but discarded keyboard focus instead of returning it to Toggle Sidebar. The controlled sheet had no Dialog trigger reference; four desktop/mobile project regressions failed focus return before the fix. | [Lost focus](product-audit/mobile-focus-lost-360.webp) | P2 | Yes — [PR #77](https://github.com/tanmay-alpha/MAET/pull/77). The shared sidebar context retains the real trigger ref; closing the sheet restores focus explicitly. |

Regression baseline: the new database journey suite initially produced **1 pass / 3 fail** (missing screener prices, demo quotes routed to market providers, and expired candles retained). Assertions were not weakened to obtain green.
The keyboard regressions also exposed J-6 after the disclosure was made accessible: Enter/Space succeeded, but Escape focus return failed in four viewport/project combinations. That assertion was retained; the sidebar was fixed instead.


## Coverage and local artifact regeneration

The 25 visited routes were `/screener`, `/watchlists`, `/world`, `/terminal`, `/orders`, `/portfolio`, `/import`, `/journal`, `/alerts`, `/strategies`, `/research/reports`, `/performance`, `/replay`, `/payoff`, `/admin/data-quality`, `/data-quality`, `/settings`, `/chart-grid`, `/compare`, `/universe`, `/heatmap`, `/backtest`, `/options/RELIANCE`, `/futures` and `/news`. All were visited at each requested width, including Experimental routes. Measured document overflow was **0 px**. Wide tables used their own scroll containers; PR #74 addresses sticky-column paint order. Loading skeletons alone were not counted as defects.

After starting the seeded production stack with the commands/environment above, regenerate the full local screenshot and JSON collection with:

```sh
bun run scripts/audit-local-journey.ts
```

The script launches its own headless Chromium, visits the same 75 route/viewport combinations without mocks or injected authentication, captures console/page errors, HTTP/network failures, focus samples and overflow, and closes the browser. It writes `test-results/journey/<route>-<width>.png` and `audit-<width>.json`; these are intentionally gitignored. Override the origin or destination with `JOURNEY_BASE_URL` or `JOURNEY_OUTPUT`. Use `bunx playwright install chromium` if Chromium is not installed. The script captures the current revision, not the historical pre-fix states, and does not replace manual visual/control inspection or the keyboard regression suite.

For reproducible setup, migration and seeding commands are:

```sh
docker exec maet-pg psql -U postgres -c "create database maet_test_journey"
NODE_ENV=test BUN_TEST=1 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:58432/maet_test_journey bun run test:db-migrate
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:58432/maet_test_journey bun run seed:demo
```

Create the database only if absent; never recreate the shared containers. Detailed interaction captures and API-response JSON were also kept locally during this audit, not committed.

## Additional interaction evidence

The corrected real backend returned `source=simulated`, `quality=synthetic`, `delayed=true` and the original `2026-11-18T10:00:00.000Z` observation time for seeded symbols, with no quote errors. Raw responses remain local artifacts (`fixed-demo-quotes.json`, `fixed-demo-companies.json`); the same paths are covered by the Postgres journey regression.

The guest import workflow was completed through real controls: Load sample tradebook → Review rows → See results. It reported 15 parsed rows, nine accepted trades, five rejected rows and one duplicate; results showed four holdings and five realised entries. Rejection reasons (impossible date, zero quantity, unmatched sell and F&O exclusion) were visible. Its screenshot remains a local artifact, `test-results/journey/import-sample-results-1440.png`. No CSV content was uploaded to a backend.

No application JavaScript exception or document-wide horizontal overflow was observed. Failed stylesheet requests are J-1. Some initial market-history calls timed out and their same-origin fallback returned 503; later desktop visits rendered all six real Chart Grid panels correctly with Yahoo/delayed labels. World Bank macro observations returned an upstream 502, which World Monitor exposed with Retry and “not yet available”; USGS/NASA data still rendered. Dummy Angel One credentials correctly failed authentication, so genuine prices came from delayed Yahoo, not a simulated live broker feed. None of these expected upstream/auth limits was hidden with fake data.

## Regression coverage

- `server/modules/demo/journey.integration.test.ts`: unfiltered stored screener prices/provenance; public synthetic quotes without external requests; demo-mode-off guard; real PostgreSQL candle retention.
- `tests/e2e/journey-findings.spec.ts`: native disclosure keyboard operation at each requested width; mobile sheet Escape/focus return; per-row synthetic provenance and original timestamp; a fresh live quote replacing a stale stored price.
- Peer tests: SSR asset availability in PR #75; source-driven labels and small-screen layout resilience in PR #74.
Checks on the merged base: `bun run typecheck` and `bun run lint` passed; `bun run check:test-wiring` reported 241 tracked test files wired; `bun run test:unit` passed 1,412 tests across 189 files; `NODE_ENV=test BUN_TEST=1 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:58432/maet_test_journey bun run test:demo` passed seven tests across two files (72 assertions); the same environment with `bun run test:ingestion` passed 14 tests across two files (71 assertions).

Final Chromium regression command: `CI= E2E_PORT=4441 bunx playwright test --retries=0` — **183 passed, 15 existing project-specific skips, 0 failed** (desktop and mobile Chromium projects). The eight new journey cases all passed. No existing skip or assertion was changed.

The real production build was then revisited at 360, 768 and 1440 px. All eight seeded prices rendered with their original timestamps and explicit synthetic labels, Experimental opened by keyboard, and Escape restored the mobile/tablet trigger focus. Follow-up screenshots and `fixed-browser.json` remain local artifacts under `test-results/journey/`; the settled data-quality capture confirmed the initial skeleton completed normally. All backend/frontend services started for the audit and the managed browser tab were stopped afterward; shared containers were left running.


Authenticated browser workflows remain unverified because no real signing/auth service is configured. This is an explicit coverage boundary, not a production auth relaxation.

## Reconciliation with screener data honesty (PR #86)

The original audit counts above describe its initial verification revision. After merging PR #86, the duplicate price-cell provenance annotation was removed. Stored and live observations now use the existing source/as-of header or per-row provenance column and its helpers; numeric cells retain unit-only formatting and missing-value semantics. Stored synthetic observations say “Synthetic demo data · not market data”; stored real observations are delayed, never live. The original observation time and stale tags are preserved.

Two new helper regressions first failed for stored synthetic/Yahoo labels, then passed after the canonical helper was corrected. `screener-data-honesty.spec.ts` and its strict numeric-cell assertions were not modified. Journey tests now wait for the rendered provenance contract rather than the obsolete currency-prefixed cell string, and verify the canonical provenance column plus exact `3,333.00` live-price precedence.

Reconciliation checks: `bun run typecheck` and `bun run lint` passed; `bun run check:test-wiring` reported **251 tracked files** wired; `bun run test:unit` passed **1,502 tests** across 197 files (383,949 assertions); the test database environment above with `bun run test:demo` passed **10 tests** across two files (86 assertions). `CI= E2E_PORT=4441 bunx playwright test --retries=0` passed **205 tests**, with 25 existing project-specific skips and zero failures. Both journey and screener-data-honesty specs passed in their applicable Chromium projects.
