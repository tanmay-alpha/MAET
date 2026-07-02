# Remaining Work

Last audited: 2026-07-02

## Completed And Verified

- Frontend and backend production builds pass.
- Nitro production bundle includes health, quote, candle, SSE, backtest, and
  tRPC routes.
- Yahoo quote, candle, and SSE fallback paths return real market data.
- Angel One uses SmartAPI WebSocket 2.0 headers, subscriptions, heartbeat,
  binary quote decoding, reconnect limits, and on-demand symbol tokens.
- tRPC protected procedures reject unauthenticated callers.
- Screener price, change, and volume filters operate on market responses.
- The scanner company universe is loaded from NSE's official equity master:
  2,071 EQ-series companies were returned in the 2026-07-02 verification.
- Company search and pagination are server-side; only the visible 25 symbols
  subscribe to broker/Yahoo quotes at a time.
- Angel One's instrument master enriches the NSE universe with live-feed tokens
  without replacing NSE as the canonical source for company identity.
- Normalized company, financial-statement, and calculated-fundamental schemas
  are included in migration `0002_company_master_and_fundamentals.sql`.
- Profitability, liquidity, leverage, efficiency, growth, cash-flow, and
  valuation ratios are calculated by a deterministic, unit-tested engine.
- Drizzle was upgraded past the identifier SQL-injection advisory.
- Render configuration installs from the workspace lockfile and declares the
  required Supabase database URL.
- Unit baseline: 92 passing, 9 environment-dependent tests skipped.

## Required Before Production Deployment

1. In Render, configure every variable listed in `.env.example`, especially
   `SUPABASE_DB_URL`. Existing Supabase API keys are not a Postgres connection
   string.
2. Confirm the Render dashboard build command is
   `cd .. && npm ci && npm run build --prefix server`; dashboard settings can
   override `render.yaml`.
3. Apply and verify the production database migration before enabling persisted
   orders, alerts, portfolios, or saved screeners.

## Product Gaps

- The normalized fundamentals pipeline is ready, but production statement data
  still requires a licensed filings/fundamentals provider and a configured
  database. Mock values are intentionally not shown; P/E, P/B, ROE, market-cap,
  sector, dividend, and growth filters must remain disabled until sourced data
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
