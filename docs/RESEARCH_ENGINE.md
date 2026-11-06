# Research engine

How MAET backtests a strategy and evaluates it out of sample, as implemented at `ca8b1bb`. File paths are cited for each mechanism. Section 9 separates what production runs from research modules that are only exercised by tests.

## 1. Where a backtest comes from

| Entry point | Path | Engine call | Results |
|---|---|---|---|
| `backtestV2.run` (tRPC, synchronous) | `server/api/trpc/routers/backtest-v2.ts` | Preset (SMA, EMA, RSI, MACD, Donchian, Bollinger) → `presetToV3Definition` (`server/domain/backtest/preset-to-v3-adapter.ts`) → `runBacktestV3`, inside the web request | `backtest_runs` |
| `strategyBacktests.createJob` (tRPC, queued) | `server/api/trpc/routers/strategy-backtests.ts`, `server/modules/strategy-jobs/repository.ts` | `server/workers/backtest-worker.ts` claims the job and calls `runBacktestV3` | `strategy_backtest_trades`, `strategy_equity_points`, `strategy_performance_snapshots` |
| `strategyOptimisation` sweeps | `server/api/trpc/routers/strategy-optimisation.ts` | `server/workers/sweep-worker.ts`: one `runBacktestV3` per parameter combination | `strategy_sweep_results` |
| `strategyOptimisation` walk-forward | same router | `server/workers/walk-forward-worker.ts` → `runWalkForwardAnalysis` (`server/domain/strategy/walk-forward.ts`) | `strategy_walk_forward_runs`, `strategy_walk_forward_windows` |

Strategies are an AST (`shared/strategy/ast.ts`, validated by `shared/strategy/schemas.ts`): entry/exit rule groups of conditions over price, market and indicator operands with lags 0–50, plus risk and execution config. Versions are immutable and identified by a SHA-256 of their canonical JSON (`server/modules/strategy-definitions/service.ts`).

Queued jobs: creation takes a per-user advisory transaction lock and enforces a cap of 3 queued/running jobs of a kind in the last 6 hours; workers claim the oldest job with `FOR UPDATE SKIP LOCKED`, heartbeat every 30 s, and recover `RUNNING` jobs whose heartbeat is older than 5 minutes (`server/modules/strategy-jobs/repository.ts`, `server/workers/backtest-worker.ts`). The workers run only as separate processes (`bun run worker:backtest|worker:sweep|worker:walk-forward`, `package.json`); the Render web service does not start them (`render.yaml`, `server/orchestrator.ts`).

## 2. runner-v3: the bar loop

`runBacktestV3` in `server/domain/strategy/runner-v3.ts` is the only engine production calls. It simulates one symbol with at most one open position.

**Preparation.** Corporate actions are applied only if the request supplies them; candles are sorted ascending; fewer than 50 candles throws `InsufficientHistoryV3Error`. The data fingerprint is the first 16 hex characters of SHA-256 over `ts:open:high:low:close:volume` of every candle (`computeDataHash`). An `IndicatorStateCache` is built over the sorted series (`server/domain/strategy/indicator-state.ts`). With `tradeFrom`, earlier candles feed indicator warm-up but never trade; the first fill bar is the first candle at or after `tradeFrom` (at least index 1) and the bar before it is the equity curve's starting mark.

**Per bar $i$**, for the default `fillPolicy: NEXT_BAR_OPEN`:

```text
signalIdx = i - 1                 # rules see data through bar i-1 only
fillPrice = open[i]
canEnter  = not inPosition and cooldown == 0      # captured before any exit this bar
if inPosition:
    ruleExit = exitRules(signalIdx) ? fill at open[i]
    exit = ruleExit or protectiveExit(bar i)      # rule exit at the open happens first
    close the trade if exit
cooldown -= 1 if cooldown > 0
if canEnter and cooldown == 0 and entryRules(signalIdx):
    size with equity, fillPrice, ATR(14) at signalIdx
    pay entry fees and slippage, open position at open[i]
    protectiveExit(bar i)                         # the rest of the entry bar still trades
equityCurve.append(mark-to-market at close[i])
```

With `fillPolicy: ON_CLOSE`, `signalIdx = i`, fills are at `close[i]`, a rule exit fills after the protective exits, and there is no entry-bar protective check. After the loop any open position is closed at the last close with reason `end_of_period`.

**Protective exits** (`protectiveExit`) are checked in a fixed conservative order: trailing stop, stop loss, take profit. If the bar opens beyond a level the fill is at the open (gap); otherwise at the level. So when one bar touches both stop and target, the stop wins. The trailing level uses the peak (trough for shorts) from *previous* bars, then updates it with the current bar. `intrabarPolicy` is returned as metadata; the order above is not configurable.

**Look-ahead guarantees and their limits:**

1. Rules are evaluated at `signalIdx = i − 1` and filled at bar $i$'s open, so a signal never trades on the bar whose close produced it.
2. Position sizing uses ATR at `signalIdx`; the only bar-$i$ input is the open, which is known at the moment of the fill.
3. The indicator cache is precomputed over the whole series, so correctness relies on every indicator being causal (trailing). The canonical implementations are trailing windows or recursive filters (`shared/indicators/canonical.ts`). Donchian channels include the current bar, which is still causal at `signalIdx`.
4. A position closed on a bar cannot re-enter on that bar (`canEnter` is captured first).
5. Tests: `server/domain/strategy/look-ahead.test.ts`, `fill-bar-look-ahead.test.ts`, `same-bar-exit-order.test.ts`, `truncated-history.test.ts`, `reproducibility.test.ts` (`package.json` `test:strategy-engine`, `test:portfolio-backtest`).

`server/domain/strategy/look-ahead-detector.ts` offers an empirical check: it overwrites all OHLCV after a pivot with absurd values (99999.99) and asserts that signal timestamps up to the pivot do not change. It compares signal timestamps only, and only tests call it.

**Sizing** (`server/domain/strategy/position-sizer.ts`): `FIXED_QUANTITY`, `FIXED_CAPITAL`, `PERCENT_OF_EQUITY` (default, 100%), `RISK_PER_TRADE`, `VOLATILITY_TARGET`, always floored to whole shares and capped by `maximumPositionPercent`. The entry requires `quantity × price ≤ equity`.

**Equity accounting.** The runner's `equity` is realised equity net of costs: entry fees and entry slippage are deducted at entry; at exit, gross P&L minus exit fees and exit slippage is added. The curve point is equity plus unrealised P&L at the close. Per trade:

$$
\text{gross} = q\,(p_{exit} - p_{entry})\ \text{(long; sign reversed for short)},\qquad
\text{net} = \text{gross} - \text{fees}_{in} - \text{fees}_{out} - \text{slip}_{in} - \text{slip}_{out}
$$

Only `SHORT_ONLY` produces shorts; `LONG_ONLY` and `LONG_SHORT` both trade long. Pyramiding, `maximumOpenPositions > 1`, daily-loss and drawdown gates are not implemented by this loop.

## 3. Cost model

**Fees** (`computeLegCharges`, `server/domain/strategy/fee-model.ts`), per leg on notional $N$:

| `feeModel` | Charge |
|---|---|
| `NONE` | 0 |
| `FIXED_BPS` | $N \cdot \text{feeBps} / 10^4$ (default 10 bps), reported as brokerage |
| `VOLUME_AWARE` | the shared statutory schedule `computeIndianEquityCharges` (`shared/domain/costs/indian-equity-charges.ts`) for `exchange` (default NSE) and `product` (default DELIVERY), side-aware, plus `brokerage` INR per order |

The statutory schedule is the same one paper trading uses (rates in [PAPER_TRADING_ENGINE.md](PAPER_TRADING_ENGINE.md) §9). `backtestV2.run` presets always use `FIXED_BPS` with 10 bps by default, or `NONE` when `feeBps` is 0 (`buildExecution` in `preset-to-v3-adapter.ts`); Strategy Lab definitions must choose a `feeModel` explicitly (`shared/strategy/schemas.ts`).

**Slippage.** `slippageBps` (default 5) is charged as money, $N \cdot \text{bps}/10^4$ on each leg; the recorded entry and exit prices stay at the reference open, close or stop/target level (`runner-v3.ts`).

**Cost drag** $= 100 \cdot \text{total costs} / \text{gross P\&L}$ when aggregate gross P&L is positive, else 0.

The spread, square-root market impact and participation-cap model in `server/domain/strategy/execution-model.ts` is **not** used by runner-v3 (§9).

## 4. Portfolio engine (research module)

`runPortfolioBacktestEngine` in `server/domain/strategy/portfolio-engine.ts` simulates many symbols on one shared cash pool. No server endpoint or worker calls it (§9); it is described because it is tested and it is the intended next step.

- **Timeline.** The sorted union of all candle timestamps; symbols with fewer than 5 bars are skipped; a symbol with no candle at a timestamp keeps its last mark.
- **Order per timestamp.** Exits first (rule exit, stop before target), then entries; a symbol closed at a timestamp cannot reopen at it.
- **Ranking.** Candidates sort descending by a key, ties by symbol: `MOMENTUM` = $(c_{sig} - c_{sig-10})/c_{sig}$; `RELATIVE_VOLUME` actually uses raw signal-bar volume; `SCORECARD_SCORE` uses volume × momentum. Under next-open, all ranking and sizing inputs come from the signal bar $i-1$.
- **Limits** per candidate: open-position cap (default 5), sector exposure of existing positions (default 40%), allocation $= \min(\text{equity}\cdot\text{pos\%},\ \text{cash} - \text{reserve})$ rejected if ≤ ₹100, gross exposure cap (default 100%); if the fill plus fees exceeds free cash the quantity is shrunk once to fit.
- **Execution** goes through `ExecutionModel` (spread, impact, participation cap on bar-$(i-1)$ volume).
- **Accounting identity.** Entry notional (long or short) is reserved from cash:

$$
E_t = \text{cash}_t + \sum_j q_j\,p^{fill}_{j} + \sum_j u_j,\qquad u_j = \pm\, q_j\,(c_{j,t} - p^{fill}_{j})
$$

- **Not implemented** despite the config type: `rebalanceSchedule` is assigned but never read; there are no trailing stops or cooldowns; positions whose history ends before the global last timestamp are not force-closed; the "reproducibility hash" is a string of lengths and capital, not a data hash.

## 5. Walk-forward analysis

`runWalkForwardAnalysis` (`server/domain/strategy/walk-forward.ts`), called by `processWalkForward` in `server/workers/walk-forward-worker.ts`.

**Windows** (`generate3PhaseWalkForwardWindows`). With span $S = t_{end} - t_{start}$ and $n$ windows, step $\Delta = \lfloor S/n \rfloor$. Window $k$ ends at $t_{start} + (k+1)\Delta$ and starts at $t_{start} + k\Delta$ (`ROLLING`) or $t_{start}$ (`ANCHORED`). Each window is split by duration: train $\lfloor 0.6\,D \rfloor$, validation $\lfloor 0.2\,D \rfloor$, test the remainder (defaults; 4 windows, rolling). Anchored windows therefore grow, and the ratios are re-applied to each growing window.

The API takes `trainingDays` and `validationDays` (`shared/strategy/contracts.ts`); the worker treats `validationDays` as the out-of-sample share and holds out 25% of the training span for validation: train ratio $0.75\,T/(T+V)$, validation $0.25\,T/(T+V)$, test $V/(T+V)$ (`walk-forward-worker.ts`). The router persists $\min(\lfloor \text{totalDays}/V \rfloor,\ 2 \cdot \text{minimumWindows})$ windows (`strategy-optimisation.ts`).

**Per window:**

1. Skip if train < 20, validation < 10 or test < 10 bars. Each phase gets up to 250 preceding bars of warm-up passed as `tradeFrom`, and is sliced to end at the phase end, so later candles are never in the indicator cache.
2. A leakage guard (`assertNoDataLeakage`) throws if the last train timestamp is after the first validation timestamp, or the last validation timestamp after the first test timestamp.
3. **Train:** run every parameter combination (Cartesian product, capped at 100; `server/domain/strategy/parameter-sweep.ts`) and keep the one with the highest training Sharpe.
4. **Validate:** run it on the validation phase; reject the window if the validation Sharpe < −1.0 or the run fails. Validation does not choose parameters; it only vetoes.
5. **Test:** only accepted windows trade out of sample, starting from the previous window's ending OOS equity, so the stitched OOS curve compounds. Rejected windows add no points.

**Summary**, over windows actually tested:

$$
\mathrm{WFE} = \frac{\overline{\mathrm{CAGR}}_{OOS}}{\overline{\mathrm{CAGR}}_{IS}}\ \ \text{if } \overline{\mathrm{CAGR}}_{IS} > 0,\qquad
\text{retention} = \frac{\overline{\mathrm{Sharpe}}_{OOS}}{\overline{\mathrm{Sharpe}}_{IS}}\ \ \text{if } \overline{\mathrm{Sharpe}}_{IS} > 0
$$

Otherwise the value is `null` with a reason string. OOS total return is $(E^{OOS}_{final} - C_0)/C_0$; OOS max drawdown is the maximum of the per-window drawdowns, not recomputed on the stitched curve.

**Robustness** (`server/domain/strategy/robustness.ts`, research only) scores a sweep: neighbours differ in 1–2 parameters by at most 1.5 steps; a "fragile spike" (best Sharpe > 1 with neighbour mean below half of it) raises `OVERFIT_RISK`; overall score $= 0.40\,s_{neighbour} + 0.25\,s_{sample} + 0.20\,s_{drawdown} + 0.15\,s_{cost}$. Its inline comments cite thresholds (1.5, 100 trades) that differ from the code (1.0, 60 trades).

## 6. Metrics

All in `computeMetrics`, `server/domain/backtest/risk-metrics.ts`. Equity samples $E_0..E_n$; periodic returns $r_t = (E_t - E_{t-1})/E_{t-1}$ (0 if $E_{t-1} = 0$); $P$ periods per year; risk-free $r_f$ annual (default 0, and runner-v3 passes none), periodic $r_{f,p} = (1+r_f)^{1/P} - 1$; $x_t = r_t - r_{f,p}$. Standard deviation is the sample one ($N-1$).

**Annualisation $P$** (`getPeriodsPerYear`): 252 for `1d`, 52 for `1wk`, 12 for monthly, and $252 \times 375 / m$ for $m$-minute bars (375 minutes per NSE session), e.g. 1575 for `1h`, 94,500 for `1m`.

| Metric | Formula |
|---|---|
| Total return | $R = (E_n - E_0)/E_0$ |
| CAGR (`annualisedReturn`) | $(1+R)^{1/y} - 1$, $y = n/P$ (bar count, not calendar time); $-1$ if $R \le -1$ |
| Volatility | $\mathrm{sd}(r)\sqrt{P}$ |
| Sharpe | $\dfrac{\bar x}{\mathrm{sd}(x)}\sqrt{P}$ |
| Sortino | $\dfrac{\bar x}{\sqrt{\frac1N \sum_t \min(0,\ r_t - r_{f,p})^2}}\sqrt{P}$, downside deviation over all $N$ periods |
| Max drawdown | $\max_t \dfrac{\max_{s \le t} E_s - E_t}{\max_{s \le t} E_s}$ |
| Calmar | $\mathrm{CAGR}/\mathrm{MDD}$ (0 if MDD = 0) |
| Benchmark return, alpha | $R_b$ from the benchmark curve; alpha $= \mathrm{CAGR} - \mathrm{CAGR}_b$ (a return difference, not CAPM alpha) |
| Win rate | trades with net P&L > 0 / all trades (zero P&L counts as a loss) |
| Profit factor | $\sum \text{wins} / \lvert\sum \text{losses}\rvert$; `null` with no losing trade |
| Expectancy | mean net P&L per trade (INR) |
| Payoff ratio | mean win / $\lvert$mean loss$\rvert$; `null` with no losing trade |
| Average holding period | mean (exit − entry) in calendar days |
| Exposure | $\min(1,\ \sum \text{holding time} / \text{curve duration})$, a fraction |
| Turnover | total traded notional / mean equity |
| Ulcer index | $\sqrt{\overline{d_t^2}}$ with $d_t$ the percentage drawdown; UPI $= \mathrm{CAGR}/(\mathrm{UI}/100)$ |

Edge cases: fewer than two equity points or $E_0 \le 0$ returns all zeros. The queued worker writes the fractional `exposure` into the `exposurePercent` column without ×100 (`server/workers/backtest-worker.ts`).

## 7. Corporate actions

`adjustCandles` in `server/domain/data/corporate-actions.ts` produces `RAW`, `SPLIT_ADJUSTED` (default) or `TOTAL_RETURN_ADJUSTED` series. Actions are applied oldest first; each multiplies every candle strictly before its ex-date (prices rounded to 4 dp, volume to whole shares):

| Action | Price factor | Volume factor |
|---|---|---|
| Split / reverse split, $a$ new for $b$ old | $b/a$ | $a/b$ |
| Bonus, $a$ bonus per $b$ held | $b/(a+b)$ | $(a+b)/b$ |
| Dividend $D$ (total-return series only) | $(c_{prior} - D)/c_{prior}$, $c_{prior}$ the raw close before the ex-date | 1 |

Rights issues and symbol changes are typed but not applied. A 2:1 split therefore never shows up as a 50% drawdown (`server/domain/strategy/p2-research-invariants.test.ts`).

**Production status:** runner-v3 adjusts only when it receives actions, and none of `backtestV2.run`, the backtest worker, the sweep worker or the walk-forward worker passes any. Backtests run on stored candles as ingested from Yahoo (`server/data/sources/yahoo.ts` reads the quote OHLC arrays, not `adjclose`); the code alone does not establish how Yahoo adjusts those.

## 8. Canonical indicators

`shared/indicators/canonical.ts` is the single implementation of the core indicators. Outputs are `(number | null)[]`, with `null` during warm-up rather than 0.

| Indicator | First non-null index | Notes |
|---|---|---|
| SMA(n) | $n-1$ | trailing mean |
| EMA(n) | $n-1$ | seeded with the SMA, $\alpha = 2/(n+1)$ |
| RSI(n) | $n$ | Wilder smoothing; 100 when average loss is 0 |
| MACD(12,26,9) | line at 25, signal after a further 9 valid values | |
| ATR(n) | $n-1$ | true range, Wilder smoothing |
| Bollinger(20, 2) | $n-1$ | population standard deviation |
| Donchian(20) | $n-1$ | includes the current bar |
| ADX(n) | $2n-1$ | Wilder |
| VWAP | first bar with volume | resets each IST calendar day |
| ROC, Stochastic, average volume, rolling extremes, SuperTrend | per window | |

`buildCanonicalSnapshot` builds the snapshot used by `server/modules/technical-snapshots/service.ts`. Consumers: the strategy `IndicatorStateCache` (which delegates SMA, EMA, RSI, MACD, Bollinger, ATR, VWAP and SuperTrend to canonical and keeps its own OBV and Donchian), the calculation registry, the screener, `server/domain/technical/indicators-extended.ts`, and the frontend chart (`src/components/trading/lightweight-chart.tsx`, `src/lib/technical-indicators.ts`). `tests/canonical-indicators.test.ts` checks canonical values against the strategy cache.

Two adapter quirks: the MACD preset writes `{fast, slow, signal}` while the cache reads `{fastPeriod, slowPeriod, signalPeriod}`, so custom MACD periods from a preset fall back to 12/26/9; and the Donchian preset compares the close with a channel that includes the current bar (`preset-to-v3-adapter.ts`, `indicator-state.ts`).

## 9. What production does not use yet

| Module | Status | Evidence |
|---|---|---|
| `ExecutionModel` (spread models, square-root impact, participation cap) | Only called by the portfolio engine; runner-v3 charges slippage as a flat bps debit. | `server/domain/strategy/execution-model.ts`, imports in `portfolio-engine.ts` only |
| Portfolio engine | No endpoint or worker calls it; the frontend imports only its types. | `server/domain/strategy/portfolio-engine.ts`, `src/components/strategy/portfolio-analytics-view.tsx` |
| Point-in-time fundamentals and universe membership | Only tests call them. | `server/domain/fundamentals/point-in-time.ts`, `point-in-time.test.ts`, `p2-research-invariants.test.ts` |
| Corporate actions in backtests | Supported by the runner, never supplied by callers; no corporate-action ingestion. | §7 |
| Robustness scoring, look-ahead detector | Only tests call them. | `robustness.ts`, `look-ahead-detector.ts` |
| In-memory replay engine | Only its test uses it; the replay router has its own DB-backed logic. | `server/modules/strategy-replay/replay-engine.ts`, `server/api/trpc/routers/strategy-replay.ts` |
| Research workers on Render | Not started by the web service. | `render.yaml`, `package.json` `worker:*` |

What production does use: runner-v3, `computeMetrics`, the fee model with the shared statutory schedule, the parameter sweep, and the walk-forward engine (through its worker).
