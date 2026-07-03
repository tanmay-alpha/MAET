# Remaining Work

Last audited: 2026-07-03

## Completed And Verified

- Frontend and backend production builds pass.
- Nitro production bundle includes health, quote, candle, SSE, backtest, and
  tRPC routes.
- Yahoo quote, candle, and SSE fallback paths return real market data.
- Angel One uses SmartAPI WebSocket 2.0 headers, subscriptions, heartbeat,
  binary quote decoding, reconnect limits, and on-demand symbol tokens.
- tRPC protected procedures reject unauthenticated callers.
- Screener identity search, pagination, sorting, and available-field filters execute server-side.
- The scanner company universe is loaded from NSE's official equity master:
  2,071 EQ-series companies were returned in the 2026-07-02 verification.
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
  migration `0003_screener_v4.sql`.
- Profitability, liquidity, leverage, efficiency, growth, cash-flow, and
  valuation ratios are calculated by a deterministic, unit-tested engine.
- Drizzle was upgraded past the identifier SQL-injection advisory.
- Render configuration installs from the workspace lockfile and declares the
  required Supabase database URL.
- Unit baseline: 93 passing, 9 environment-dependent tests skipped.

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
4. Run `bun run smoke:screener-v4` from an environment containing the same
   database and Redis URLs. It processes only RELIANCE, HDFCBANK, TCS, INFY,
   and 20MICRONS, logs before/after counts, and fails if a second pass creates
   duplicate rows.

## Product Gaps

- The normalized fundamentals pipeline and Yahoo adapter are ready, but Yahoo
  quoteSummary returned HTTP 401 from both query hosts on 2026-07-03.
  Production statement data therefore still requires a reachable verified
  provider and a configured database. Filters stay disabled until sourced data
  has been stored and validated.
- Saved screeners currently persist in browser local storage. The tRPC saved
  screener procedures still need a database table and ownership-scoped CRUD.
- Portfolio day P&L, Sharpe, drawdown, beta, sector allocation, and realized
  trade P&L still contain TODO implementations.
- Options-chain open interest/volume, some financial panels, and some analytics
  helpers still generate demonstration values. They must not be represented as
  broker/live data.
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
- The 2026-07-03 local five-symbol smoke test reached PostgreSQL and Redis,
  confirmed real NSE identities/ISINs, stored five new Yahoo quote snapshots,
  retained 115 deduplicated daily candles, and left unavailable fundamentals
  empty. A repeated pass changed no row counts. Render still needs its separate
  database connection fixed as described above.
