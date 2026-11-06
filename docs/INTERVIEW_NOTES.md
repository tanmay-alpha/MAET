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
- Playwright tests (`bun run test:e2e`, `tests/e2e/`) drive the real pages against mocked APIs, including the signed-out, expired-session and backend-down states.

## Recent features

Each feature below follows the same shape: what it does, where the code is, the hard parts, how it is tested, and the questions I expect. Product-level descriptions are in the [README](../README.md); this section is about the reasoning.

### F1. Returns and capital-gains tax

**What it does.** The portfolio page (`/portfolio`) shows the paper account's money-weighted annual return (XIRR) and an estimated Indian capital-gains tax for a chosen financial year. Every figure comes from real fills; a signed-out visitor sees a notice, not sample numbers.

**Data flow.** `src/components/investing/returns-tax.tsx` (`ReturnsTaxSection`) → tRPC `paperTrading.investingReport` (protected, input `financialYearStart`) → `PaperInvestingReportService.getReport` in `server/modules/paper-trading/investing-report.ts`, which reads accounts, fills and positions in a `repeatable read`, `read only` transaction and calls the pure engines `xirr` (`shared/domain/investing/xirr.ts`) and `buildCapitalGainsReport` / `matchFifoLots` (`shared/domain/investing/capital-gains.ts`).

**Hard parts and decisions.**

- **XIRR solver.** It solves $\sum a_i (1+r)^{-t_i} = 0$ with $t_i$ = actual days / 365. I substitute $x = \ln(1+r)$, so every candidate is an admissible rate ($r > -1$), and scale amounts by the largest absolute flow. Newton starts at 10% and runs at most 100 steps; if the derivative vanishes, a step leaves the bounds or stalls, it falls back to bisection. The bracket is found by expanding from the guess (0.125, doubling) and bisection runs at most 200 steps. Convergence is a relative residual of $10^{-12}$. It returns `null`, never `NaN`/`Infinity`, for fewer than two flows, no sign change, all flows on one day or no root. Trade-off: I wrote it rather than use a package because the `xirr` package is Newton-only and `formulajs` has an unbounded Newton loop (noted in the file); the cost is owning the numerics, which is why the test list is long.
- **FIFO per generation.** Resetting a paper account increments `generation`; matching filters on it, so pre-reset fills never leak into cost basis. Lots are keyed by exchange and symbol. Same-day buys and sells are first netted as intraday (speculative, excluded from capital-gains tax); only the net residual enters delivery FIFO.
- **Tax rules.** Long-term means held more than 12 calendar months (s.2(42A)). Exits before 23 July 2024 use 15% STCG (s.111A) / 10% LTCG (s.112A); exits on or after it use 20% / 12.5%. The rate switches on the exit date, not at the financial-year boundary. The s.112A exemption is ₹1,00,000 before FY2024-25 and ₹1,25,000 from FY2024-25, one aggregate limit across both rate groups, so it applies in full even if every sale in that year was before 23 July. Cess is 4% of base tax.
- **Set-off order.** Each of the four buckets (ST/LT × old/new rate) nets internally; remaining LTCL offsets LTCG (old then new) and never STCG; remaining STCL offsets STCG old, STCG new, LTCG old, LTCG new; the exemption then reduces LTCG old then new. The report itself says this is a deterministic convention, not a claim of optimal allocation.
- **Stated limits.** Surcharge, slab rates, brought-forward losses, grandfathering and corporate-action basis adjustments are not modelled; gains use gross fill prices (STT is not deductible under s.48). These are listed in the report's `assumptions` so the UI can show them.

**Proof.** `shared/domain/investing/xirr.test.ts`: "matches the published Excel irregular-cash-flow reference", "matches the published LibreOffice reference to its displayed precision", "uses bisection when the default Newton derivative vanishes", "handles returns near minus 100 percent and very large positive rates", "is invariant under cash-flow scaling". `capital-gains.test.ts`: "changes rates on July 23, 2024 and applies one aggregate 125000 exemption to the transition FY", "uses the whole transition FY exemption even when all transfers precede July 23", "treats exactly twelve calendar months as STCG, next day as LTCG, including leap anniversaries", "sets LTCL only against LTCG and STCL against STCG then LTCG, old buckets first". `server/modules/paper-trading/investing-report.integration.test.ts`: "returns an uninitialised account without creating balances or snapshots", "isolates another user and discards previous-generation fills after a reset".

**Likely questions.**

- *Why the log transform?* Newton on $r$ can step below −100%, where $(1+r)^t$ is undefined. In $x = \ln(1+r)$ every real $x$ is valid, and I clamp $x$ to the range where `exp` neither underflows nor overflows.
- *What if there are several roots?* Newton from 10% picks the root nearest that guess; if Newton fails, the first sign change found while expanding symmetrically is used. A test pins this ("selects the default-guess root deterministically when multiple roots exist").
- *Why not CAGR?* CAGR ignores when money went in. XIRR weights each cash flow by time, which is what a portfolio with deposits and partial sales needs.
- *Is the tax figure filing-grade?* No. It's an estimate with its assumptions listed; it ignores surcharge, slabs and carried-forward losses.
- *Why is the report read-only?* Opening the page must not create an account or write snapshots; the integration test checks that an uninitialised account stays uninitialised.

### F2. Broker tradebook import

**What it does.** `/import` reads a Zerodha Console tradebook, a Groww order history or any CSV with mapped columns, and shows holdings, realised gains per financial year and XIRR. The file never leaves the browser.

**Data flow.** `src/routes/_app.import.tsx` (file → review → results) → `src/lib/import/read-csv-file.ts` (`readCsvFile`) → `CsvStreamParser` in `shared/domain/investing/import/csv.ts` → `normalizeRows` / `detectFormat` / `guessMapping` (`normalize.ts`), `parseTradeDate` (`dates.ts`) → `analyseImport` (`analyse.ts`), which calls the same `matchFifoPositions`/`buildCapitalGainsReport` and `xirr` as F1. UI pieces: `src/components/import/{file-step,review-step,results-step}.tsx`.

**Hard parts and decisions.**

- **CSV parsing.** A small hand-written RFC 4180 parser: quoted fields with commas and newlines, `""` as an escaped quote, CRLF/CR/LF line ends, a leading BOM stripped, blank rows skipped, and an unclosed quote raises an error with the line number instead of guessing. It is incremental (`push`/`end`), so the same rows come out however the input is split. Trade-off: no dependency and no second copy of the file in memory, but I own the edge cases; the chunking test covers that.
- **Chunked reading.** `readCsvFile` reads `file.stream()` chunk by chunk with a streaming `TextDecoder` (so a multi-byte `₹` split across chunks decodes correctly), reports progress, and yields to the event loop between chunks to keep the page responsive.
- **Dates.** Slashed dates are always day-first (Indian brokers), never US month-first; impossible dates like 30 Feb return `null`. Financial years run April–March.
- **Validation.** Every row is accepted, rejected with a reason (bad date, zero quantity, unknown side, F&O segment, non-executed Groww order) or marked a duplicate trade id. Rows are sorted by trade date before checking holdings, and a sell larger than the quantity held is rejected before FIFO (`rejectOversells`), because a delivery tradebook can't short. That differs from the paper engine, which allows shorts.
- **Reuse.** Imported fills go into the F1 engines with `exchange = "DEMAT"` (NSE and BSE shares pool into one demat holding) and a single generation 0, so tax and XIRR rules exist in one place.
- **Privacy.** Parsing and analysis happen client-side. The only network call is the optional "Fill from MAET quotes", which sends only the symbol list (in batches of 50) to `/api/market/quotes`. XIRR waits until every open holding has a price, because valuing a holding at zero would invent a loss.

**Proof.** `shared/domain/investing/import/import.test.ts`: "handles a BOM, CRLF line endings, quoted commas and escaped quotes", "gives the same rows when the input arrives in arbitrary chunks", "rejects an unterminated quoted field instead of guessing", "rejects a sell larger than the quantity held at that time, leaving the holding intact", "orders by trade date, not file order, before checking holdings", "treats exactly twelve months across a leap year (366 days) as STCG and the next day as LTCG", "waits for a price on every holding, then values them on the as-of date". `tests/e2e/import.spec.ts`: "sample tradebook: row counts, realised gains per FY, quote-filled prices and XIRR" and "uploads a Groww order history with BOM, CRLF and quoted values" (fixture `tests/e2e/fixtures/groww-orders.csv`).

**Likely questions.**

- *Why not upload and parse on the server?* A tradebook is personal financial data. Keeping it in the tab means there is nothing to store, secure or delete, and the engines are pure TypeScript in `shared/`, so they run in the browser unchanged.
- *Why not Papa Parse?* Broker exports only need the core RFC 4180 grammar, and an incremental parser of about 70 lines is easy to test exhaustively. For messier inputs a library would be the better call.
- *How do you handle a 50 MB file?* It is streamed in the browser's chunks with progress and event-loop yields; the review table renders at most 500 rows. The parsed rows are still held in memory.
- *What does "duplicate" mean?* The same `(symbol, trade id)` seen again; the later row is marked, not silently dropped.

### F3. Options Payoff Lab

**What it does.** `/payoff` builds multi-leg option and futures positions (CE/PE/FUT, buy/sell, strike, lots, premium), plots the expiry payoff and today's Black-Scholes value, and reports exact breakevens, max profit/loss, net credit/debit and position Greeks. Premiums are the user's inputs; templates leave them blank rather than invent prices.

**Data flow.** `src/routes/_app.payoff.tsx` → `src/lib/payoff-lab-state.ts` (URL/session state and validation) → `shared/domain/options/payoff.ts` (`expiryProfile`, `positionGreeks`, `STRATEGY_TEMPLATES`), `black-scholes.ts` (price and Greeks), `index-contracts.ts` (lot sizes). The options chain (`/options/$underlying`) links into it via `payoffSearchForChainContract` with the clicked strike as a bought leg.

**Hard parts and decisions.**

- **Exact figures, not a sampled curve.** Expiry payoff is piecewise linear and only bends at strikes, so `expiryProfile` evaluates it at 0 and every distinct strike. Breakevens are zeros at a kink, linear interpolation where adjacent kink values change sign, and one crossing on the right tail. Max profit/loss is the max/min over the kinks unless the tail is unbounded.
- **Unlimited detection.** The slope beyond the highest strike is the sum of signed units of CE and FUT legs (puts are flat there). Positive slope → max profit `Infinity`; negative → max loss `-Infinity`. The left side is bounded because the underlying can't go below 0. No "large number" threshold is involved.
- **Black-Scholes.** European, no dividend yield, one flat IV for all legs. `normCdf` uses Hart's double-precision approximation (West 2005), about $10^{-14}$. Theta is per calendar day ($T$ = days/365), vega and rho per 1 percentage point. At or after expiry it returns intrinsic value. Inputs that make the formula meaningless (non-positive spot/strike, zero volatility before expiry) throw `RangeError`.
- **Lot sizes.** NIFTY 65, BANKNIFTY 30, FINNIFTY 60, from NSE circular NSE/FAOP/70616 (3 Oct 2025), cited in `index-contracts.ts`. They are defaults and remain editable, because lot sizes are revised periodically.
- **URL state.** The whole lab is in the query string (`sym`, `spot`, `lot`, `step`, `exp`, `r`, `iv`, `legs`, `ivs`); legs are `side_instrument_strike_lots_premium` joined by `~`. Every field uses Zod `.catch(undefined)`, so a bad value is dropped instead of breaking the page. A shared URL wins over the last session in `localStorage` (`maet:payoff-lab`). Defaults: 6.5% rate, 14% IV, up to 12 legs.

**Proof.** `shared/domain/options/payoff.test.ts`: "finds an iron condor's breakevens at the short strikes ∓ net credit", "detects the unlimited loss of a naked short call analytically", "bounds a long put's profit by the underlying's floor at zero", "aggregates position Greeks as signed leg Greeks × lots × lot size". `black-scholes.test.ts`: "prices the textbook at-the-money option (S=100, K=100, T=1, r=5%, σ=20%)", "satisfies put-call parity C − P = S − K·e^(−rT)", "agrees with central finite differences of the price". `src/lib/payoff-lab-state.test.ts`: "round-trips contract inputs and legs, keeping blank premiums blank", "drops search values that fail validation instead of rejecting the page". `tests/e2e/payoff.spec.ts`: "payoff lab: an iron condor from a template shows exact risk figures, a chart, and survives a shared URL".

**Likely questions.**

- *Why not sample 1,000 prices and take the max?* Sampling can miss a breakeven between grid points and can't tell "very large" from "unlimited". The piecewise-linear structure gives exact answers in O(strikes).
- *How do you know the Greeks are right?* Each Greek is checked against a central finite difference of the price, and the price against a textbook value and put-call parity.
- *Is Black-Scholes right for NIFTY options?* They are European-style index options, so it's a reasonable model, but one flat IV ignores skew and there's no dividend yield. That's why the before-expiry curve is treated as mark-to-model P&L, not a price forecast; the IV-shift slider shows how sensitive it is.
- *Why put state in the URL?* A strategy can be shared or bookmarked and reloads intact. Edits use `replace`, so they don't flood browser history, and invalid parameters are dropped rather than failing the page.

### F4. World Monitor

**What it does.** `/world` is a public page that puts recent earthquakes (USGS), open natural events (NASA EONET), geopolitical and macro headlines (GDELT) and GDP growth/CPI for six economies (World Bank) on one map and in tables. A rule engine links some events to NSE sectors and symbols worth watching; it makes no price prediction.

**Data flow.** `src/routes/_app.world.tsx` (React Query: events refetch every 5 min, news 2 min, macro 24 h) → public `GET /api/world/{events,news,macro}` (`server/api/world/*.get.ts`, `cache-control: no-store`) → `worldService` in `server/modules/world/service.ts` → one lazy cache per source (`cache.ts`) → adapters that validate and normalise each feed (`adapters.ts`) → bounded HTTP (`http.ts`). Shared types are in `shared/world/contracts.ts`; the exposure rules are in `shared/world/exposure-rules.ts`. UI: `src/components/world/{world-map,event-tables,market-strip,panel}.tsx`.

**Hard parts and decisions.**

- **TTL plus stale-while-error.** Each source has a TTL (USGS 1 min, EONET 5 min, World Bank 24 h). Nothing is fetched until the first request, and concurrent readers share one in-flight fetch. On failure the cache keeps the last good data *and its original `fetchedAt`*, marks it `stale` with the error, and waits a cooldown (60 s; 5 min for World Bank) before retrying. A first-ever failure is reported as unavailable, not as an empty feed. Trade-off: users may see old data, but it's labelled with its real timestamp, which beats an empty page.
- **Bounded upstream calls.** 8 s timeout via `AbortController`, a byte cap checked against `content-length` and while streaming (2 MB default, 1 MB for GDELT), and HTTP or JSON errors are errors, never "no events".
- **GDELT pacing.** Six topic queries go through `createSpacedQueue` with 5 s between request starts, and the 5 s gap is measured from when the previous request *settles*, so slow requests don't compress it. Each query, including failed ones, runs at most once per 15 minutes. `news()` returns as soon as the first due query settles instead of blocking for the whole queue; the rest fill later reads.
- **Rule-based exposure.** `matchExposure` is pure and deterministic. A match needs the right event category, a whole-word headline topic and the region (bounding box with inclusive edges, country code, or a place name in the headline). The GDELT publisher's country is deliberately *not* treated as where the event happened. Eight rules (e.g. Bay of Bengal storms → ports/refiners, RBI rate headlines → banks); every watch symbol is a shipped NSE symbol, checked by a test. Trade-off: rules are explainable and testable but miss anything they don't name; I chose that over an opaque classifier.
- **Map.** MapLibre GL (BSD-3-Clause) on the keyless OpenFreeMap dark style. EONET polygons don't get invented centroids, and non-earthquake events aren't sized by "magnitude" because their units differ. The worker URL is set explicitly (`setWorkerUrl`) because the bundled worker broke in production builds.
- **TradingView ticker tape.** It's TradingView's official embed with its copyright attribution kept, used only for display; its prices never enter MAET's rules or calculations (`docs/ARCHITECTURE.md`). Reasoning: hosted widgets are licensed for display, and TradingView's widget FAQ rules out extracting their data into your own analytics. The CSP in `src/routes/__root.tsx` allows only TradingView's script and frame hosts.
- **Abuse.** `/api/world/` is in the rate limiter's prefixes because a public request can trigger an upstream refresh.

**Proof.** `server/modules/world/cache.test.ts`: "retains last good data and timestamp during failure cooldown, then recovers", "reports an initial failure as unavailable rather than a successful empty feed", "coalesces refreshes and does not fetch before first read". `http.test.ts`: "waits the full spacing after a slow request settles, not after it started", "enforces streaming byte limits even without content-length and cancels the body". `service.test.ts`: "limits every GDELT query including failures to one attempt per fifteen minutes". `adapters.test.ts`: "does not invent polygon centroids or news locations" (against trimmed real recordings in `__fixtures__/`). `shared/world/exposure-rules.test.ts`: "does not treat publisher country as event geography", "includes every bounding-box edge and corner and excludes points just outside", "uses unique rule IDs and only shipped active NSE watch symbols". `server/middleware/rate-limit.test.ts`: "limits the public world endpoints, which can trigger upstream refreshes". `tests/e2e/world.spec.ts`: "world: stale payload stays useful and Retry fetches the source again", "world: empty observations are explicit instead of fabricated".

**Likely questions.**

- *Why proxy through your server instead of calling the APIs from the browser?* One cached upstream call serves every visitor, GDELT's rate expectations are respected centrally, payloads are validated once, and the CSP stays tight.
- *Why in-memory caches and not Redis?* The data is public and cheap to refetch; losing it on restart costs one request per source. With several instances each would fetch separately, which is acceptable at these TTLs.
- *Isn't "exposure" just a guess?* It's a documented rule with its text shown next to the match, not a signal. Tests check that unrelated geography or headlines produce no match.
- *What happens if GDELT is down?* News shows the last good articles with their fetch time and a stale marker; other sources are unaffected because each has its own cache.

### F5. Honest UI states

**What it does.** Screens show only numbers the server actually returned. If the account isn't loaded, the session expired or the backend is down, the UI says so and offers a retry instead of showing a default balance.

**Data flow.** `src/hooks/use-paper-account.ts` → `paperAccountStatus` / `paperAccountBlockedReason` in `src/lib/paper-account-status.ts` → dashboard, terminal and portfolio (`src/routes/_app.{dashboard,terminal,portfolio}.tsx`). Signed-out dashboard: `src/components/trading/guest-market-dashboard.tsx`, `guest-market-movers.ts`. Source labels: `src/lib/quote-source.ts`, `src/lib/quote-status.ts`. Screener presets: `src/lib/screener-presets.ts`. Circuit breaker: `server/data/drizzle/availability.ts`, `server/infra/health.ts`.

**Hard parts and decisions.**

- **No invented balances (PR #40).** The dashboard and terminal used to fall back to `1000000` when the account was `null`, so a failed request looked like a fresh ₹10 lakh account. Now the account is one of five states: `signed-out` (no stored session; the cache is ignored), `loading`, `ready`, `unauthorized` (a 401 `AuthenticationError`, even if an older account is cached) and `unavailable` (any other error). Only `ready` exposes figures; loading shows skeletons with `aria-busy`, failures show a notice with Retry, and Quick Trade/Reset are disabled with the reason as their tooltip. Trade-off: a brief network blip hides figures that were probably still right; I prefer that to showing numbers I can't vouch for.
- **Signed-out dashboard.** It makes no protected tRPC calls. It shows NIFTY 50 movers from one public `/api/market/quotes` call, a device-local watchlist (`localStorage`, quotes fetched in batches of 50) and links into research pages.
- **Truthful source labels.** Provider ids map to names ("Angel One", "Yahoo", "Stored snapshot"). `quoteFeedLabel` only says "Live quotes" for non-delayed quotes; delayed quotes say "Delayed", "Pre-open · delayed" or "Market closed · last available quotes"; an error says "Quote service unavailable". A missing change shows "—", not 0.00%.
- **Gainers/Losers sort.** The presets only set a change filter and kept alphabetical order, so the biggest movers were scattered across pages (commit `928f62d`). Gainers now sorts by change % descending and Losers ascending. With the database down, the NSE fallback list has no stored change, so `arrangeLivePage` filters and sorts the current page by live quotes, symbol as tie-break, missing values last.
- **DB circuit breaker.** A connection-class error (`ECONNREFUSED`, SQLSTATE class 08, `57P01`–`57P03`, …) opens it at once; probe timeouts alone need 3 in a row, so a busy pool doesn't trip it. After 30 s it goes half-open and allows one trial: success closes it, failure re-opens it, and a query that started before it opened can't close it. While open, guarded reads fail immediately with `DatabaseUnavailableError` instead of waiting for the 10 s connect timeout, `/api/health` reports `degraded` with `databaseCircuit: "open"`, the screener shows an offline banner and hides empty stored columns, and the strategy-job runner and snapshot scheduler pause. Paper-trading writes don't consult the breaker; they fail loudly (Q10).

**Proof.** `src/lib/paper-account-status.test.ts`: "a 401 means the stored session was rejected, even with an account cached from before", "server and network failures make the account unavailable, never stale-but-shown". `tests/e2e/paper-account-state.spec.ts`: "expired session: /dashboard asks to sign in again and invents no balances", "backend down: Retry loads the account once the server answers again". `tests/e2e/signed-out.spec.ts`: "signed out: /terminal makes no protected calls and asks the visitor to sign in". `tests/e2e/quote-freshness.spec.ts`: "after hours: closed-market delayed quotes are labelled delayed, never live". `tests/e2e/screener.spec.ts`: "screener: Gainers sorts by change % descending and Losers ascending", "screener: with the database offline, presets sort the live page by change % and empty columns are hidden". `server/data/drizzle/availability.test.ts`: "does not let a query that started before the breaker opened close it", "does not open on a probe timeout alone (busy pool) until three consecutive failures".

**Likely questions.**

- *Why was a default balance a bug and not a convenience?* In a trading UI a plausible number is worse than none: a user can't tell "your account has ₹10 lakh" from "we couldn't load your account".
- *Why distinguish `unauthorized` from `unavailable`?* They need different actions: sign in again versus retry later. Both show no figures.
- *Why half-open with a single trial?* After an outage, letting every request through at once would stampede a recovering database; one trial decides.
- *Why doesn't the breaker guard writes?* A write must either commit or fail visibly. Failing fast on reads is a latency optimisation; for writes the normal error path is already correct.

### F6. Data licensing awareness

These are the constraints I checked while designing the data paths. They shape what MAET claims; they are not legal advice.

- **NSE.** NSE's [data policy](https://www.nseindia.com/static/market-data/nse-data-policy) restricts dissemination and redistribution of its market data except under agreement; being end-of-day, delayed or behind a login doesn't change that. A free download such as the bhavcopy is not a republication licence ([circular MSD77208](https://nsearchives.nseindia.com/content/circulars/MSD77208.pdf)). That's why MAET is described as a research and paper-trading project, and why quotes carry their source and delay rather than claiming to be exchange data.
- **Yahoo.** Yahoo's [terms of service](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) (sections 2(d), 2(e), 2(h)) prohibit automated collection and redistribution without permission. An endpoint being reachable is not a licence. In MAET Yahoo is a delayed fallback, labelled `delayed`, and paper MARKET orders refuse it by default (Q5).
- **TradingView.** The [widget data FAQ](https://www.tradingview.com/widget-docs/faq/data/) says symbol availability and delays follow exchange licensing, and hosted widgets can't be scraped or fed into your own engines. Hence: display-only ticker tape on `/world`, and charts drawn with Lightweight Charts (Apache-2.0, a code licence that says nothing about data).
- **World Monitor sources.** USGS feeds are US public domain with attribution; EONET needs no key but asks for attribution; World Bank indicators are CC BY 4.0; GDELT allows reuse of its metadata with citation, but linked articles keep their publishers' copyright, so MAET links out and never republishes article bodies. Sources and links are listed in `docs/ARCHITECTURE.md`.
- **What I'd say in an interview.** A commercial launch would need a licensed data vendor or an exchange agreement. Today the design labels every quote with its source and delay, uses Yahoo only as a fallback, and doesn't sell or export data. Stored Yahoo candles for backtests are the part a licence review would look at first.

## Trade-offs I made

| Decision | Benefit | Cost |
|---|---|---|
| One Render web service running the market workers in-process | Free tier, simple deploy, no queue infrastructure | Single point of failure; CPU-heavy work (a synchronous `backtestV2.run`) shares the event loop with tick matching |
| Margin account (cash moves only by realised P&L and fees) with 5× leverage | Allows shorts and simple equity maths; margin calls are meaningful | Not how a cash (CNC) account behaves; buying power is not "cash" |
| Pessimistic locking + SERIALIZABLE + unique constraints | Strong correctness, easy to reason about | Lower throughput per account; retries add latency under contention |
| Reject delayed quotes for execution | Fills are always against a tradable live price | Orders are refused whenever the live feed is down or for BSE |
| Every paper fill charged at DELIVERY rates | Conservative: never understates costs | Overstates intraday costs about 6× (₹222 vs ₹35 per ₹1 lakh round trip) |
| Transactional outbox for events | Events can never disagree with committed state | Delivery is at-least-once and needs Redis; the UI keeps polling as a fallback |
| Pure domain logic in `shared/` | Testable and reused by paper trading, backtests and UI | Two layers to keep in sync (domain types vs DB rows), e.g. `TRIGGER_PENDING` maps to domain `PENDING` |
| Backtest metrics from bar counts | Deterministic and simple | CAGR ignores gaps in the calendar (holidays, missing data) |

## What I'd do next

1. Add a dead-letter state for outbox events that keep failing, and replace the 1 s publisher poll with `LISTEN/NOTIFY`.
2. Auto-release or force-close stuck `LIQUIDATION_PENDING` accounts on a timer, and re-evaluate them from the last known close outside market hours.
3. Add a product field (CNC/MIS) to paper orders, charge intraday rates for MIS, and square off MIS positions at 15:20.
4. Run the research workers as a separate Render worker (or a queue), and move `backtestV2.run` onto the job queue.
5. Wire corporate actions and point-in-time fundamentals into backtests, and replace the flat bps slippage with the existing `ExecutionModel`.
6. Add a property-based test that $\sum \text{ledger} = \text{cash}$ after random sequences of fills, cancels and resets.
7. Add a global Angel One token budget across market streams, alerts and paper interest, and a BSE live source.
