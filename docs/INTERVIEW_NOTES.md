# MAET interview notes

Short, code-grounded answers to questions an interviewer is likely to ask about MAET. Each answer names the files to open if asked to go deeper. Longer explanations are in [ARCHITECTURE.md](ARCHITECTURE.md), [PAPER_TRADING_ENGINE.md](PAPER_TRADING_ENGINE.md) and [RESEARCH_ENGINE.md](RESEARCH_ENGINE.md).

## Questions and answers

### 1. What is MAET, in one minute?

A research and paper-trading platform for Indian equities. The frontend is React 19 on TanStack Start, deployed to Vercel. The backend is a Nitro/H3 server with tRPC, Drizzle and PostgreSQL (Supabase), deployed as one Render web service. Live NSE prices come from the Angel One SmartAPI WebSocket and REST, with Yahoo as a delayed fallback. Users can screen and chart stocks, backtest rule-based strategies with Indian statutory costs, run walk-forward analysis, and paper-trade with a margin account. Nothing is ever sent to a real broker. Code layout: `src/`, `server/`, `shared/`; the wiring is in `server/orchestrator.ts` and `server/api/trpc/index.ts`.

### 2. How do you prevent double fills?

With layers, so no single mechanism has to be perfect:

1. Every fill locks the user's `paper_accounts` row (`SELECT … FOR UPDATE`) first, which serialises all money-moving work for that user.
2. The tick matcher reads candidate orders without locks, then re-reads each order under lock and skips it unless it is still working and in the current account generation (`server/modules/paper-trading/tick-processor.ts`).
3. Each order stores the SHA-256 fingerprint of the last quote that filled it, so the same tick cannot fill it twice (`quote-fingerprint.ts`).
4. `paper_fills` has unique `(order_id, quote_fingerprint)` and `(order_id, execution_sequence)` constraints, and the ledger has a unique key per fill and entry type.
5. Transactions run at SERIALIZABLE and are retried on `40001`/`40P01` (`transaction-retry.ts`).

`server/modules/paper-trading/concurrency.integration.test.ts` races cancels against fills and concurrent partial-fill ticks on real PostgreSQL.

### 3. Why both `FOR UPDATE` and SERIALIZABLE?

The row lock gives a deterministic queue per account and a fixed lock order (account first), which avoids most conflicts and deadlocks. SERIALIZABLE catches what the explicit locks don't cover, for example the `MAX(execution_sequence)` read used to number fills. Because the whole callback re-reads state under lock, retrying it (at most 3 attempts, 20 ms then 50 ms back-off) is safe. I also keep network I/O out of the transaction: the MARKET path loads and validates the quote before `BEGIN` (`placeMarketOrder` in `service.ts`).

### 4. How does order idempotency work?

The client sends an `idempotencyKey` (required by `PaperOrderCommandSchema`). Under the account lock the service looks the key up for that user and account generation. Same terms (prices compared at the stored 4-decimal precision) return the original order and fill with `idempotentReplay: true`; different terms return a 409/`CONFLICT`. A partial unique index on `(user_id, generation, idempotency_key)` is the backstop. The replay check runs before the market-hours and quote checks, so a retry after 15:30 still gets the original answer. One caveat: the browser creates a new key per mutation call (`src/hooks/use-paper-account.ts`), so this protects transport retries, not double clicks.

### 5. How do you stop fills against bad prices?

`evaluateExecutionQuote` (`shared/types/market.ts`) is applied on every execution path. It rejects stale or synthetic quotes, rejects delayed ones (any Yahoo quote) unless `PAPER_EXECUTION_ALLOW_DELAYED=true`, rejects timestamps more than 10 s in the future, and rejects quotes older than `PAPER_EXECUTION_MAX_QUOTE_AGE_MS` (15 s by default). MARKET orders additionally need the market phase to be `OPEN` (09:15–15:30 IST, NSE holidays excluded, `server/domain/market/clock.ts`) and a quote from the order's own exchange. A broker quote is relabelled `delayed` outside the session (`sessionQuality`), so a last-traded price from 15:29 cannot be executed at 15:45.

### 6. How does a resting LIMIT order get filled?

Every executable tick on the in-process bus goes to `PaperTradingTickProcessor.processTick`. It triggers stops (`price <= stop` for SELL, `>= stop` for BUY), checks LIMIT marketability, and fills at most `max(1, floor(10% of the volume traded since the previous tick))` per tick, so large orders fill gradually. The fill price is the tick price plus tiered slippage, capped at the limit. A business rejection such as insufficient margin leaves the order working. Files: `server/workers/order-matcher.ts`, `tick-processor.ts`, `volume-tracker.ts`, `shared/domain/paper-trading/execution.ts`.

### 7. How do brackets and OCO work?

Take-profit and stop-loss exits are created on the entry's first fill, sized to the filled quantity, and grow with each further entry fill. Each exit fill shrinks its sibling by the same amount; when the position is flat the sibling is cancelled. An exit can never close more than the position it protects (`closableExitQuantity`), and if a manual trade closes or flips the position, other brackets' exits on that symbol are cancelled. The bracket stop is a stop-market order, because a stop-limit at the stop price never fills when the price gaps through it. Code: `applyEntryFillToBracket`, `applyExitFillToSiblings` in `shared/domain/paper-trading/execution.ts`.

### 8. How does margin and liquidation work?

Leverage is 5: allocated margin is $\sum |q|\bar p / 5$ and maintenance margin is 80% of that. A fill is refused if projected allocated margin would exceed projected equity (cash plus unrealised P&L). Every 2 s the risk monitor passes the latest executable prices to the SQL function `calculate_live_margin`, which returns accounts whose equity is below maintenance. The liquidation service re-checks under the account lock, sets `LIQUIDATION_PENDING`, cancels working orders and closes every position that has an executable quote; once flat the account is `LIQUIDATED`. If prices recover first, it releases the account. Files: `shared/domain/paper-trading/margin.ts`, `risk-monitor.ts`, `liquidation-service.ts`, migration `0023`.

### 9. How do you keep the books consistent?

Cash only changes through the ledger: every fill writes a `TRADE_REALIZED_PNL` row and an `EXECUTION_FEE` row in the same transaction, and account opening or reset writes `INITIAL_CASH`. So for each generation, cash = initial + Σ realised − Σ fees = Σ ledger amounts. Fills and ledger rows are append-only, enforced by triggers that raise on UPDATE or DELETE (migration `0012`), and every fill keeps the quote source, quality, timestamp and fingerprint it executed against, for audit.

### 10. What happens when the database is down?

`/api/health` still returns HTTP 200 but reports `degraded` (deliberately, so Render does not restart the instance during an external outage). Quotes keep working because that path is in memory plus the providers. Candle requests fall back to Yahoo. Paper trading and strategy operations fail with a masked 500 / `INTERNAL_SERVER_ERROR`; there is no in-memory fallback for money-moving operations, which I think is right. Files: `server/infra/health.ts`, `server/domain/market/candle-service.ts`, `server/api/trpc/core.ts`.

### 11. And when Angel One or Redis is down?

Angel One REST failures fall back to Yahoo per symbol. Those quotes are delayed, so the UI still shows prices but paper MARKET orders are refused. WebSocket loss reconnects with exponential back-off, and a rejected session triggers a re-login with back-off from 1 s up to 60 s (`server/workers/angelone-ws.ts`, `server/workers/relogin-backoff.ts`). Redis is not in the quote path. Without it the candle cache is skipped, the optional Redis rate-limit store falls back to memory, and the paper SSE stream can't subscribe, so the UI keeps polling.

### 12. How do you avoid look-ahead bias in backtests?

In `runBacktestV3`, rules are evaluated on bar $i-1$ and filled at bar $i$'s open (`signalIdx = i - 1`, `fillPrice = open[i]`). Position sizing uses ATR at the signal bar. Stops and targets are checked inside the bar in a fixed conservative order: trailing stop, stop loss, then take profit, with gap fills at the open. A position closed on a bar cannot re-enter on the same bar. Indicators are causal: the canonical implementations use trailing windows and output `null` during warm-up. In walk-forward runs each phase's candles are sliced to end at the phase boundary, and a guard throws if timestamps overlap. Tests: `look-ahead.test.ts`, `fill-bar-look-ahead.test.ts`, `same-bar-exit-order.test.ts`.

### 13. How do you model trading costs?

There is one statutory schedule, `computeIndianEquityCharges` in `shared/domain/costs/`, used by both paper fills and backtests. It covers STT, exchange transaction charges (NSE 0.00297%, BSE 0.00375%), the SEBI fee, stamp duty and 18% GST on brokerage plus exchange and SEBI charges, side-aware and rounded to paise. Backtests choose `NONE`, `FIXED_BPS` or `VOLUME_AWARE` (statutory). Slippage is a bps debit per leg (default 5 bps). In paper trading, slippage is tiered by order value (5, 15 or 30 bps) and applied to the fill price.

### 14. How is Sharpe computed, and how do you annualise intraday data?

$\text{Sharpe} = \bar x / \mathrm{sd}(x) \cdot \sqrt{P}$, where $x$ are periodic returns minus the periodic risk-free rate (default 0) and sd is the sample standard deviation. Sortino uses downside deviation over all periods. $P$ is 252 for daily bars and $252 \times 375 / m$ for $m$-minute bars, since an NSE session is 375 minutes; that gives 1575 for hourly bars. CAGR uses the bar count divided by $P$, not calendar time. Code: `server/domain/backtest/risk-metrics.ts`.

### 15. What is your walk-forward analysis and WFE?

Each window splits into train, validation and test phases (60/20/20 by default; the worker derives the ratios from the requested training and OOS days). Parameters are chosen by the best training Sharpe. Validation can only veto a window, if its Sharpe falls below −1. Only accepted windows trade out of sample, and their OOS curves are stitched with compounding equity. WFE is mean OOS CAGR divided by mean in-sample CAGR, reported as `null` with a reason when the in-sample mean is ≤ 0, rather than a misleading ratio. Code: `server/domain/strategy/walk-forward.ts`, `server/workers/walk-forward-worker.ts`.

### 16. Do you handle splits, bonuses and dividends?

The adjustment code does: backward adjustment strictly before the ex-date, applied oldest first. A split $a{:}b$ scales prices by $b/a$; a bonus by $b/(a+b)$; a dividend (total-return series only) by $(c - D)/c$ (`server/domain/data/corporate-actions.ts`). To be honest: no production backtest path supplies corporate actions yet, and no corporate-action ingestion exists, so backtests run on stored Yahoo candles.

### 17. How are the APIs secured?

- **Identity:** Supabase JWTs are verified with `jose` against the project's JWKS, with issuer and audience checked. Admin rights come only from `app_metadata.role` (`server/api/trpc/auth.ts`).
- **Authorisation:** `protectedProcedure` requires a user, and every paper query filters by that user.
- **Defence in depth:** RLS gives users owner-only `SELECT` on paper tables, revokes client writes, and makes history append-only by trigger (migrations `0009`–`0012`, `0026`).
- **Abuse limits:** token-bucket rate limits per IP (300, refill 5/s) and per user (120, refill 2/s); tRPC batching disabled; a 256 KiB declared body cap.
- **Error masking:** in production, internal tRPC errors become "Internal server error" with no stack. I'd add that masking is not global: two handlers still return raw messages.

### 18. Why tRPC and a `shared/` package?

The frontend and backend agree on types without code generation, and Zod schemas validate inputs at runtime. More importantly, `shared/` holds pure domain logic: execution, margin, position reconciliation, charges and indicators. That logic has no I/O, so it is unit-testable, and paper trading, backtesting and the chart use the same code. The canonical indicators are a good example: `tests/canonical-indicators.test.ts` checks them against the strategy engine's cache.

### 19. How would this scale beyond one instance?

Correctness would hold, because all money-moving state is in PostgreSQL behind row locks, unique constraints and SERIALIZABLE transactions, so two matchers can't double-fill. Efficiency would not. The quote store, volume tracker, risk-monitor marks, memory rate-limit buckets and SSE slots are per process, and every instance would match every tick. The next steps would be the Redis rate-limit store (already implemented, `RATE_LIMIT_STORE=redis`), a single elected matcher or partitioning by symbol, and moving the job workers to their own service.

### 20. How do you test it?

- Unit tests (`bun run test:unit`) cover pure domain logic, metrics and indicators.
- The paper engine has integration suites against real PostgreSQL 16: engine integrity, risk and liquidation, concurrency, and migration upgrade tests. They run in CI as separate jobs (`.github/workflows/ci.yml`).
- `check:test-wiring` fails CI if a test file isn't reachable from `test:all`, so tests can't silently stop running.
- DB tests refuse to run without an explicit `TEST_DATABASE_URL` (`server/data/drizzle/client.ts`).

## Trade-offs I made

| Decision | Benefit | Cost |
|---|---|---|
| One Render web service running the market workers in-process | Free tier, simple deploy, no queue infrastructure | Single point of failure; CPU-heavy work (a synchronous `backtestV2.run`) shares the event loop with tick matching |
| Margin account (cash moves only by realised P&L and fees) with 5× leverage | Allows shorts and simple equity maths; margin calls are meaningful | Not how a cash (CNC) account behaves; buying power is not "cash" |
| Pessimistic locking + SERIALIZABLE + unique constraints | Strong correctness, easy to reason about | Lower throughput per account; retries add latency under contention |
| Reject delayed quotes for execution | Fills are always against a tradable live price | Orders are refused whenever the live feed is down or for BSE |
| Every paper fill charged at DELIVERY rates | Conservative: never understates costs | Overstates intraday costs about 6× (₹222 vs ₹35 per ₹1 lakh round trip) |
| Transactional outbox for events | Events can never disagree with committed state | The publisher isn't started yet, so the UI polls |
| Pure domain logic in `shared/` | Testable and reused by paper trading, backtests and UI | Two layers to keep in sync (domain types vs DB rows), e.g. `TRIGGER_PENDING` maps to domain `PENDING` |
| Backtest metrics from bar counts | Deterministic and simple | CAGR ignores gaps in the calendar (holidays, missing data) |

## What I'd do next

1. Start the paper outbox publisher (inside a transaction, so `SKIP LOCKED` works) and push fills to the UI over SSE instead of polling.
2. Subscribe the live feed to symbols with resting orders and open positions, add the BSE exchange type, and auto-release or force-close stuck `LIQUIDATION_PENDING` accounts on a timer.
3. Add a product field (CNC/MIS) to paper orders, charge intraday rates for MIS, and square off MIS positions at 15:20.
4. Run the research workers as a separate Render worker (or a queue), and move `backtestV2.run` onto the job queue.
5. Wire corporate actions and point-in-time fundamentals into backtests, and replace the flat bps slippage with the existing `ExecutionModel`.
6. Add a property-based test that $\sum \text{ledger} = \text{cash}$ after random sequences of fills, cancels and resets.
7. Make `getDb()` prefer the production URL outside tests, register the SIGTERM shutdown handler, and close the DB pool on shutdown.
