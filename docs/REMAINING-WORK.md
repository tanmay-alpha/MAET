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
- Drizzle was upgraded past the identifier SQL-injection advisory.
- Render configuration installs from the workspace lockfile and declares the
  required Supabase database URL.
- Unit baseline: 86 passing, 9 environment-dependent tests skipped.
- Rendered screener QA: 20 rows loaded, a volume filter reduced results to 5,
  API/SSE responses were 200, and no browser console errors were present.

## Required Before Production Deployment

1. Push the audited changes and let Render/Vercel deploy the same commit.
2. In Render, confirm every variable listed in `.env.example`, especially
   `SUPABASE_DB_URL`. Existing Supabase API keys are not a Postgres connection
   string.
3. Confirm the Render dashboard build command is
   `cd .. && npm ci && npm run build --prefix server`; dashboard settings can
   override `render.yaml`.
4. During NSE market hours, verify `/api/health` reports
   `angelone: live stream connected` and that SSE ticks have
   `source: angelone`. Credentials are not available in the local audit, so the
   real broker login cannot be asserted here.
5. Apply and verify the production database migration before enabling persisted
   orders, alerts, portfolios, or saved screeners.

## Product Gaps

- Fundamental scanner data is not connected. The legacy NSE HTML URL returns
  404 and direct NSE APIs reject server-side traffic. Mock fundamentals were
  removed; connect a reliable licensed fundamentals provider before enabling
  P/E, P/B, ROE, market-cap, or dividend filters.
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
- Verify the deployed Vercel and Render URLs after the next push; the old Render
  hostname did not respond during this audit.
