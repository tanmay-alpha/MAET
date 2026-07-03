# Remaining Work

Last audited: 2026-07-03

## Completed And Verified

- Frontend and backend production builds pass.
- `bun run preview --prefix src -- --port 8080` builds and starts a local
  Node-server preset instead of trying to execute Vercel function output.
- Nitro production bundle includes health, quote, candle, SSE, backtest, and
  tRPC routes.
- Yahoo quote, candle, and SSE fallback paths return real market data.
- Angel One uses SmartAPI WebSocket 2.0 headers, subscriptions, heartbeat,
  binary quote decoding, reconnect limits, and on-demand symbol tokens.
- tRPC protected procedures reject unauthenticated callers.
- Screener identity search, pagination, sorting, and available-field filters execute server-side.
- The scanner company universe is loaded from NSE's official equity master.
  The 2026-07-03 database sync stored 2,058 active EQ-series companies and
  6,174 verified symbol/ISIN/Yahoo identifiers.
- Company search covers symbol, company name, and ISIN; only the visible 50 symbols
  subscribe to broker/Yahoo quotes at a time.
- Angel One's instrument master enriches the NSE universe with live-feed tokens
  without replacing NSE as the canonical source for company identity.
- Angel One's authenticated REST quote snapshot supplies last traded prices
  when the exchange is closed or the WebSocket has not emitted a fresh tick.
- When NSE blocks Render's data-center IP, the backend reads the same official
  NSE-derived, cached company pages through the production Vercel edge route;
  Angel token hydration remains independent of that fallback.
- Normalized company, identifier, quote-snapshot, financial-statement,
  calculated-fundamental, and cap-classification schemas are included through
  migration `0003_screener_v4.sql`; migration `0004_quality_audit_tables.sql`
  adds ingestion audit and anomaly tables.
- Yahoo `quoteSummary` still returns HTTP 401, but the verified public
  fundamentals-timeseries fallback now supplies normalized annual/quarterly
  statements and market ratios. After the first bounded Nifty 500 batch, the
  database has verified market caps for 15 companies and 142 statement periods.
- Official Nifty 500 fundamentals enrichment is resumable in bounded batches:
  `ENRICH_OFFSET=0 ENRICH_LIMIT=25 bun run enrich:nifty500`. Each run upserts
  verified Yahoo results and reports the next offset without fetching candles.
- Profitability, liquidity, leverage, efficiency, growth, cash-flow, and
  valuation ratios are calculated by a deterministic, unit-tested engine.
- The options-chain route no longer renders randomly generated market values;
  it shows an explicit unavailable state until a verified derivatives feed exists.
- Drizzle was upgraded past the identifier SQL-injection advisory.
- Render configuration installs from the workspace lockfile and declares the
  required Supabase database URL.
- Unit baseline: 101 passing, 9 environment-dependent tests skipped.

## Required Before Production Deployment

1. The operator reports migrations `0001` through `0003` are applied, but the
   2026-07-03 Render health check still reports `database: Failed query: select
   1`. Correct `SUPABASE_DB_URL` until `/api/health` reports the database as
   reachable. Use the Supabase transaction-pooler URI (normally port 6543,
   `sslmode=require`) and URL-encode password special characters.
2. Redis now reports reachable on Render. Supabase REST still reports HTTP 401,
   so verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` independently of the
   PostgreSQL connection string.
3. Confirm the Render dashboard uses the commands in `render.yaml`; dashboard
   settings can override repository configuration.
4. Repeat `bun run smoke:screener-v4` after production credential changes. The
   2026-07-03 local run passed for RELIANCE, HDFCBANK, TCS, INFY, and
   20MICRONS, including statements and an idempotent second pass.

## Screenshot Todo Audit

- [x] Phase 0: tests, typecheck, server build, frontend lint/build.
- [x] Phase 1.1: symbol, company-name, and ISIN search.
- [x] Phase 1.2: filter chips, active states, unavailable tooltips.
- [x] Phase 1.3: loading, API error, and empty-result states.
- [x] Phase 1.4: screener tabs, sortable columns, visibility controls.
- [x] Phase 2: 2,058-company NSE identity universe stored in PostgreSQL.
- [ ] Phase 3 (partial): Yahoo timeseries enrichment works and a resumable Nifty
  500 batch command is available; the production batches still need to finish.
- [x] Phase 4: Angel One quote/token/WebSocket integration.
- [ ] Phase 5 (partial): local Supabase and Redis pipeline verified; Render's separate
  PostgreSQL/REST credentials remain unhealthy.
- [x] Phase 6: 1D, 5D, 1M, 6M, 1Y, 3Y, 5Y, and All chart ranges.
- [x] Phase 7: volume, SMA/EMA, RSI, and MACD are exposed on the chart.
- [x] Phase 8: safe NSE TradingView links on screener and chart views.
- [ ] Phase 9 (partial): Vercel and GitHub deployment verification pass; Render health
  remains degraded until its environment variables are corrected.
- [x] Phase 10: final local verification and main-branch push workflow.

## Product Gaps

- Fifteen companies are fundamentals-enriched after two bounded batches. Run the
  Nifty 500 enrichment in small sequential batches, advancing `ENRICH_OFFSET`
  only to the reported next offset. A partially failed batch reports its symbols
  and keeps the same offset so the idempotent batch can be retried safely.
  Yahoo availability still controls actual coverage.
  Market-cap buckets deliberately stay unknown until at least 250 verified
  market caps exist; ranking a five-company partial universe would be false.
- Saved screeners currently persist in browser local storage for unauthenticated
  visitors. The existing `screener_runs` table and ownership-scoped tRPC CRUD
  can be used after the frontend has a verified authenticated user session.
- Portfolio day P&L, Sharpe, drawdown, beta, sector allocation, and realized
  trade P&L still contain TODO implementations.
- Some unused legacy financial and analytics helpers still contain demonstration
  generators. The user-visible options-chain route is now honest and unavailable;
  remaining generators must not be connected to production views.
- Paper-order placement has persistence paths, but a complete fill lifecycle,
  idempotency middleware, and production integration tests remain necessary.
- The NSE holiday calendar needs a maintained source or an operations process.

## Test Gaps

- Redis/idempotency/rate-limit/SSE-hub integration tests are skipped unless a
  test Redis instance is available.
- Add committed end-to-end journeys for authentication, scanner, backtest,
  paper order, portfolio, and reconnect behavior.
- Run a market-hours soak test for Angel One reconnects and token subscriptions.
- Re-run deployed scanner search/pagination and broker-stream browser journeys
  after each production deployment.
- The 2026-07-03 local smoke test reached PostgreSQL and Redis, synchronized
  2,058 companies and 6,174 identifiers, verified five fundamentals snapshots
  and 46 financial-statement periods, and changed no row counts on a repeated
  pass. Render still needs its separate database connection fixed as described
  above.
