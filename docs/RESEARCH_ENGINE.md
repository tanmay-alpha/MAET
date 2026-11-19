# Research engine

How MAET backtests a strategy and evaluates it out of sample, as implemented at `ca8b1bb`. File paths are cited for each mechanism. Section 9 separates what production runs from research modules that are only exercised by tests.

## 1. Where a backtest comes from

| Entry point | Path | Engine call | Results |
|---|---|---|---|
| `backtestV2.run` (tRPC, synchronous) | `server/api/trpc/routers/backtest-v2.ts` | Preset (SMA, EMA, RSI, MACD, Donchian, Bollinger) → `presetToV3Definition` (`server/domain/backtest/preset-to-v3-adapter.ts`) → `runBacktestV3`, inside the web request | `backtest_runs` |
| `strategyBacktests.createJob` (tRPC, queued) | `server/api/trpc/routers/strategy-backtests.ts`, `server/modules/strategy-jobs/repository.ts` | `server/workers/backtest-worker.ts` claims the job and calls `runBacktestV3` | `strategy_backtest_trades`, `strategy_equity_points`, `strategy_performance_snapshots` |
| `strategyOptimisation` sweeps | `server/api/trpc/routers/strategy-optimisation.ts` | `server/workers/sweep-worker.ts`: one `runBacktestV3` per parameter combination | `strategy_sweep_results` |
| `strategyOptimisation` walk-forward | same router | `server/workers/walk-forward-worker.ts` → `runWalkForwardAnalysis` (`server/domain/strategy/walk-forward.ts`) | `strategy_walk_forward_runs`, `strategy_walk_forward_windows` |

Strategies are an AST (`shared/strategy/ast.ts`, validated by `shared/strategy/schemas.ts`): entry/exit rule groups of conditions over price, market and indicator operands with lags 0–50, plus risk and execution config. Versions are immutable and identified by a SHA-256 of their canonical JSON (`canonicalDefinitionJson`: every field at every depth, object keys sorted, so key order never matters and any nested change is a new hash; `server/modules/strategy-definitions/service.ts`). Hashes stored before that fix covered only the top-level scalar fields, so one re-save of an unchanged legacy definition can create a new version instead of a conflict.

**Rejected settings.** Validation (the Zod schema for API input, and `validateAst` when a stored draft is versioned) rejects settings the engine would otherwise ignore (`unsupportedStrategyFeatures` in `shared/strategy/ast.ts`): `direction: LONG_SHORT` (one entry rule group cannot say which signals go long and which short), `risk.atrStopMultiplier`, `risk.allowPyramiding: true` and `risk.maximumPyramids`. runner-v3 still runs definitions stored before the check (`LONG_SHORT` trades long) and adds an `UNSUPPORTED_SETTING_IGNORED` warning per setting.

Queued jobs: creation takes a per-user advisory transaction lock and enforces a cap of 3 queued/running jobs of a kind in the last 6 hours; workers claim the oldest job with `FOR UPDATE SKIP LOCKED`, heartbeat every 30 s, and recover `RUNNING` jobs whose heartbeat is older than 5 minutes (`server/modules/strategy-jobs/repository.ts`, `server/modules/strategy-optimisation/repository.ts`; sweeps and walk-forward runs use `updated_at` as their heartbeat). The job runner (`server/modules/strategy-jobs/runner.ts`) runs inside the web service, started by `server/plugins/strategy-jobs.ts` unless `STRATEGY_JOBS_IN_PROCESS=false` (then `bun run worker:strategy-jobs` runs it standalone). It executes one job at a time, awaits a checkpoint after every backtest (handing the event loop back to the API and letting it stop the job), fails a job after `STRATEGY_JOB_TIME_BUDGET_MS` (default 15 min), requeues the running job on shutdown, and fails rather than requeues an abandoned job older than 6 hours. Results and the `COMPLETED` status are written in one transaction that commits only while the worker still holds the job.

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

**Risk gates**, evaluated on every bar's closing mark $M_i$ (equity plus unrealised P&L at `close[i]`) after the bar's exits and entries. A triggered gate closes any open position at `close[i]` (a market-on-close order whatever the fill policy, so it uses no later data) and the curve point is the realised equity after exit costs:

| Gate | Condition | Effect |
|---|---|---|
| Equity depleted | $M_i \le 0$ | exit reason `equity_depleted`; no further trades (`TRADING_HALTED` warning) |
| `maximumDrawdownPercent` $d$ | $(\max_{s<i} M_s - M_i)/\max_{s<i} M_s \ge d\%$, peak including the starting capital | exit reason `max_drawdown`; no further trades (`TRADING_HALTED` warning) |
| `maximumDailyLossPercent` $l$ | $(D - M_i)/D \ge l\%$, $D$ the last mark before the bar's IST calendar day began | exit reason `daily_loss_limit`; no entries until the first bar of the next IST day (`DAILY_LOSS_LIMIT` warning with the day count) |

Once equity is at or below zero the curve stays flat, so `computeMetrics` never scores a move on a non-positive base (a further adverse move on negative equity would otherwise appear as a positive return). With daily bars every bar is its own day, so the daily-loss gate compares each close with the previous one.

**Protective exits** (`protectiveExit`) are checked in a fixed conservative order: trailing stop, stop loss, take profit. If the bar opens beyond a level the fill is at the open (gap); otherwise at the level. So when one bar touches both stop and target, the stop wins. The trailing level uses the peak (trough for shorts) from *previous* bars, then updates it with the current bar. `intrabarPolicy` is returned as metadata; the order above is not configurable.

**Look-ahead guarantees and their limits:**

1. Rules are evaluated at `signalIdx = i − 1` and filled at bar $i$'s open, so a signal never trades on the bar whose close produced it.
2. Position sizing uses ATR at `signalIdx`; the only bar-$i$ input is the open, which is known at the moment of the fill.
3. The indicator cache is precomputed over the whole series, so correctness relies on every indicator being causal (trailing). The canonical implementations are trailing windows or recursive filters (`shared/indicators/canonical.ts`). Donchian channels include the current bar, which is still causal at `signalIdx`.
4. A position closed on a bar cannot re-enter on that bar (`canEnter` is captured first).
5. Tests: `truncated-history.test.ts` is the strongest check: a run that never saw bars after time $T$ must agree with the full-history run on every trade closed and every equity point marked before $T$ (for runner-v3 and the portfolio engine, long and short, both fill policies). `metamorphic-invariants.test.ts` repeats that over seeded random paths and random cut points, and also replaces every bar after the cut with unrelated data (trades closed, entries made and marks up to and including the cut must not change), with the risk gates enabled. `fill-bar-look-ahead.test.ts` perturbs the fill bar's high/low/close/volume and checks that sizing and fills decided at its open do not change. Also `look-ahead.test.ts`, `same-bar-exit-order.test.ts`, `runner-v3-risk-gates.test.ts` and `reproducibility.test.ts` (all in `server/domain/strategy/`, run by `test:unit`).

`server/domain/strategy/look-ahead-detector.ts` offers an empirical check: it overwrites all OHLCV after a pivot with absurd values (99999.99) and asserts that signal timestamps up to the pivot do not change. It compares signal timestamps only, and only tests call it.

**Sizing** (`server/domain/strategy/position-sizer.ts`): `FIXED_QUANTITY`, `FIXED_CAPITAL`, `PERCENT_OF_EQUITY` (default, 100%), `RISK_PER_TRADE`, `VOLATILITY_TARGET`, always floored to whole shares and capped by `maximumPositionPercent`. The entry requires `quantity × price ≤ equity`.

**Equity accounting.** The runner's `equity` is realised equity net of costs: entry fees and entry slippage are deducted at entry; at exit, gross P&L minus exit fees and exit slippage is added. The curve point is equity plus unrealised P&L at the close. Per trade:

$$
\text{gross} = q\,(p_{exit} - p_{entry})\ \text{(long; sign reversed for short)},\qquad
\text{net} = \text{gross} - \text{fees}_{in} - \text{fees}_{out} - \text{slip}_{in} - \text{slip}_{out}
$$

Only `SHORT_ONLY` produces shorts; validation rejects `LONG_SHORT`, and a stored `LONG_SHORT` definition trades long with a warning. Pyramiding and `maximumOpenPositions > 1` are not implemented by this loop (pyramiding is rejected at validation).

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

The spread, square-root market impact and participation-cap model in `server/domain/strategy/execution-model.ts` is **not** used by runner-v3 (§9). Its participation cap fills at most $\lfloor V_{i-1} \cdot \min(1, \text{rate}) \rfloor$ shares; when that is 0, or the reference volume is missing, zero, negative or non-finite, the order fills nothing and the fill carries `rejectionReason` (`PARTICIPATION_CAP` or `NO_REFERENCE_VOLUME`). Forced exits ignore the cap.

## 4. Portfolio engine (research module)

`runPortfolioBacktestEngine` in `server/domain/strategy/portfolio-engine.ts` simulates many symbols on one shared cash pool. No server endpoint or worker calls it (§9); it is described because it is tested and it is the intended next step.

- **Timeline.** The sorted union of all candle timestamps; symbols with fewer than 5 bars are skipped; a symbol with no candle at a timestamp keeps its last mark.
- **Order per timestamp.** Under next-open: (A) held positions are marked to bar $i$'s open, and only exits that fill at the open happen (a rule exit decided on $i-1$, or a stop/target the bar opens beyond); (C) entries are decided and filled at the open; (D) stops and targets touched later in the bar (on held and new positions), the end-of-period close-out and the close mark follow. So neither the cash an intrabar stop frees nor any of bar $i$'s high, low or close can fund or size an entry at its open. Under on-close every exit happens at the complete bar, then entries at the close. A symbol closed at a timestamp cannot reopen at it.
- **Ranking.** Candidates sort descending by a key, ties by symbol: `MOMENTUM` = $(c_{sig} - c_{sig-10})/c_{sig}$; `RELATIVE_VOLUME` actually uses raw signal-bar volume; `SCORECARD_SCORE` uses volume × momentum. Under next-open, all ranking and sizing inputs come from the signal bar $i-1$.
- **Limits** per candidate, all checked on the portfolio as it would stand after the order (exposures valued at the step-A marks, the order at the higher of its fill and reference price): open-position cap (default 5); sizing budget $= \min(\text{equity}\cdot\text{pos\%},\ \text{cash} - \text{reserve})$; the order's exposure may not exceed $\min(\text{budget},\ \text{sector headroom},\ \text{gross headroom})$, where headroom = cap% × equity − current exposure (sector default 40%, gross default 100%). An order over that cap or over free cash (after fill frictions and charges) is resized down; it is rejected if the cap is ≤ ₹100 or the resized order rounds to 0 shares. Caps bind at entry only; later price moves can drift exposure above a cap. `excludedSignalsByReason` counts rejections (`MAX_OPEN_POSITIONS`, `SECTOR_EXPOSURE_CAP`, `GROSS_EXPOSURE_CAP`, `INSUFFICIENT_CAPITAL`, `ZERO_SIZE`, `NON_POSITIVE_EQUITY`, `PARTICIPATION_CAP`, `NO_REFERENCE_VOLUME`).
- **Execution** goes through `ExecutionModel` (spread, impact, participation cap on bar-$(i-1)$ volume).
- **Accounting identity.** Entry notional (long or short) is reserved from cash:

$$
E_t = \text{cash}_t + \sum_j q_j\,p^{fill}_{j} + \sum_j u_j,\qquad u_j = \pm\, q_j\,(c_{j,t} - p^{fill}_{j})
$$

- **Reproducibility hash**: SHA-256 (hex) of the canonical JSON of the definition, capital, resolved constraints, ranking, rebalance schedule, price series, sectors, corporate actions, every symbol's candles (sorted by time) and the benchmark candles.
- **Not implemented** despite the config type: `rebalanceSchedule` is assigned but never read (it is part of the hash); there are no trailing stops, cooldowns, or drawdown/daily-loss gates; positions whose history ends before the global last timestamp are not force-closed.

## 5. Walk-forward analysis

`runWalkForwardAnalysis` (`server/domain/strategy/walk-forward.ts`), called by `runWalkForwardJob` in `server/workers/walk-forward-worker.ts`.

**Spans.** The API takes `trainingWindowDays` $T$ and `validationWindowDays` $V$ (`shared/strategy/contracts.ts`, stored as `training_days` / `validation_days`). Every window has three adjacent phases of exact calendar-day lengths: training $T$, validation $V$ and out-of-sample test $V$ (`walkForwardRunSpans`). There is no hidden ratio: the router, worker, engine and run dialog ("Training days", "Validation / test days") all use these spans. The run's `to` date is inclusive, so the engine range is $[\text{from}, \text{to} + 1\,\text{ms})$ (`walkForwardRange`).

**Windows** (`generate3PhaseWalkForwardWindows`). Test segments are $V$ long, adjacent, and the last one ends at the range end; window $k$'s validation is the $V$ days before its test and its training the $T$ days before that (`ROLLING`) or everything from the range start (`ANCHORED`, so training grows). Windows step by $V$, so the validation of window $k+1$ is the test of window $k$: still after window $k+1$'s training, so no leakage. With range length $R$, $n = \lfloor (R - T - 2V)/V \rfloor + 1$ windows fit (`countWalkForwardWindows`). The router rejects a run unless $n \ge$ `minimumWindows` (needs $T + V + \text{minimumWindows}\cdot V$ days) and stores $\min(n,\ 2\cdot\text{minimumWindows})$ as `window_count`; when that is below $n$ the engine keeps the most recent windows, so the earliest days serve only as training history (or not at all, for rolling windows).

Example: 2024-01-01 to 2024-12-31 ($R$ = 366 days), $T = 120$, $V = 40$: $n = \lfloor 166/40 \rfloor + 1 = 5$; the tests run 2024-06-15 to 2025-01-01 in five 40-day segments and the first training phase starts 2024-01-07. (Before this fix the range was cut into equal slices and split by ratio, giving roughly 91-day windows whatever was requested.)

**Per window:**

1. Skip the window (warning, no row) only if its test segment has no candles. Each phase gets up to 250 preceding bars of warm-up passed as `tradeFrom`, and is sliced to end at the phase end, so later candles are never in the indicator cache.
2. A leakage guard (`assertNoDataLeakage`) throws if the last train timestamp is after the first validation timestamp, or the last validation timestamp after the first test timestamp.
3. **Train (in sample):** with at least 20 training and 5 validation bars, run every parameter combination (Cartesian product, capped at 100; `server/domain/strategy/parameter-sweep.ts`) and keep the one with the highest training Sharpe. This is a retrospective best-of-N pick, so the training metrics are optimistic.
4. **Validate (out-of-sample holdout):** run it on the validation phase; reject the window if the validation Sharpe < −1.0 or the run fails. Validation does not choose parameters; it only vetoes.
5. **Test (out of sample), cash-or-trade:** an accepted window trades its test segment starting from the previous segment's ending OOS equity, so the stitched OOS curve compounds. A window that was rejected, could not select parameters (too few bars, every training run failed) or whose test run failed **holds cash**: it adds a flat segment (the as-of mark plus every test bar at the running equity) to the stitched curve, gets zero OOS metrics, and is stored with `test_metrics.position = "CASH"` and a `cashReason`.

**Summary.** In-sample means are over windows that selected parameters; out-of-sample per-window means are over **every** window, cash windows counting as 0:

$$
\mathrm{WFE} = \frac{\overline{\mathrm{CAGR}}_{OOS}}{\overline{\mathrm{CAGR}}_{IS}}\ \ \text{if } \overline{\mathrm{CAGR}}_{IS} > 0,\qquad
\text{retention} = \frac{\overline{\mathrm{Sharpe}}_{OOS}}{\overline{\mathrm{Sharpe}}_{IS}}\ \ \text{if } \overline{\mathrm{Sharpe}}_{IS} > 0
$$

Otherwise the value is `null` with a reason string (also when no window selected parameters). A walk-forward whose windows were all rejected therefore reports WFE 0, not "undefined". The stitched curve gives `oosReturnTotal` $= (E^{OOS}_{final} - C_0)/C_0$, `oosAnnualisedReturn`, `oosSharpe` and `oosDrawdownMax` (`computeMetrics` over the whole stitched curve, so drawdowns spanning windows count). Counts: `acceptedWindowsCount`, `testedWindowsCount` (traded), `cashWindowsCount`, `totalWindowsCount`.

**Labels.** The stored `oos_summary.methodology` records the spans, `dayBasis: "CALENDAR"`, the step, `selection` (`IN_SAMPLE`, `RETROSPECTIVE_BEST_TRAINING_SHARPE`, `trialsPerWindow`), `validation` (`OUT_OF_SAMPLE_HOLDOUT`, veto below Sharpe −1), `test` (`OUT_OF_SAMPLE`) and `rejectedWindowPolicy: "CASH"`. `strategyOptimisation.getWalkForward` returns it with the run; the results view shows it above the windows table.

**Benchmark.** `oos_summary.benchmark` is buy-and-hold of the same symbol over exactly the stitched OOS dates (first test start to last test end), run through runner-v3 with the strategy's own `execution` settings (fee model, slippage, fill policy) and the same starting capital, fully invested with no stops (`buyAndHoldDefinition`). It is `null` with `benchmarkReason` when that run fails. Runs stored before this change have no methodology or benchmark, and their summaries averaged only tested windows.

No PBO is computed for walk-forward runs: only the selected parameter set is tested out of sample, and training phases of rolling windows overlap, so there is no common T x N return matrix to cross-validate. The trial count per window is reported instead.

**Robustness** (`server/domain/strategy/robustness.ts`) scores a sweep; `strategyOptimisation.getSweep` returns it for a finished sweep (`server/modules/strategy-optimisation/sweep-robustness.ts`): neighbours differ in 1–2 parameters by at most 1.5 steps; a "fragile spike" (best Sharpe > 1 with neighbour mean below half of it) raises `OVERFIT_RISK`; overall score $= 0.40\,s_{neighbour} + 0.25\,s_{sample} + 0.20\,s_{drawdown} + 0.15\,s_{cost}$. Its inline comments cite thresholds (1.5, 100 trades) that differ from the code (1.0, 60 trades).

**Multiple testing (sweeps).** A sweep's best result is a retrospective in-sample pick among all its parameter sets; `getSweep` returns `robustness.selection = { sample: "IN_SAMPLE", method: "RETROSPECTIVE_BEST_SHARPE", trials, pbo, pboReason }`. The probability of backtest overfitting uses combinatorially symmetric cross-validation (Bailey, Borwein, López de Prado and Zhu, 2015; `pboFromBlockStats`, `probabilityOfBacktestOverfitting`): the sweep job cuts each combination's per-bar returns into $S$ contiguous blocks (the same blocks for every combination) and stores $(n, \sum r, \sum r^2)$ per block as `result_summary.returnBlocks`. For each of the $\binom{S}{S/2}$ ways to pick half the blocks as in sample, the combination with the best in-sample Sharpe (mean / sample standard deviation of per-bar returns) is found; its out-of-sample rank $r$ among $N$ (1 = worst, ties averaged) gives $\omega = r/(N+1)$ and $\lambda = \ln(\omega/(1-\omega))$. PBO is the share of splits with $\lambda \le 0$; the result also has `trials` $N$, `blocks`, `splits` and the median $\lambda$. $S$ is the largest even number $\le 16$ that leaves 4 returns per block and keeps $\binom{S}{S/2} \cdot N \cdot S/2 \le 3{,}000{,}000$ block sums (so 16 up to 29 combinations, 14 up to 124, 12 up to 500), keeping the computation to tens of milliseconds per request. PBO is `null` with a reason for fewer than two combinations, too few bars, or results stored before `returnBlocks` existed.

`getSweep` strips `returnBlocks` from the result rows it returns. The Strategy Lab sweep view does not display `selection` yet; it is available on the API.

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

Edge cases: fewer than two equity points or $E_0 \le 0$ returns all zeros. The queued backtest job stores `exposure × 100` in the `exposurePercent` column (`server/workers/backtest-worker.ts`); snapshots written before that fix hold the fraction.

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

`buildCanonicalSnapshot` builds the snapshot used by `server/modules/technical-snapshots/service.ts`. Consumers: the strategy `IndicatorStateCache` (which delegates SMA, EMA, RSI, MACD, Bollinger, ATR, VWAP and SuperTrend to canonical and keeps its own OBV and Donchian), the calculation registry, the screener, `server/domain/technical/indicators-extended.ts`, and the frontend chart (`src/components/trading/lightweight-chart.tsx`). `tests/canonical-indicators.test.ts` checks canonical values against the strategy cache.

One adapter quirk: the Donchian preset compares the close with a channel that includes the current bar (`preset-to-v3-adapter.ts`, `indicator-state.ts`).

## 9. What production does not use yet

| Module | Status | Evidence |
|---|---|---|
| `ExecutionModel` (spread models, square-root impact, participation cap) | Only called by the portfolio engine; runner-v3 charges slippage as a flat bps debit. | `server/domain/strategy/execution-model.ts`, imports in `portfolio-engine.ts` only |
| Portfolio engine | No endpoint, worker or frontend code calls it; only its tests do. | `server/domain/strategy/portfolio-engine.ts` |
| Point-in-time fundamentals and universe membership | Only tests call them. A fundamentals row whose `availableFrom` is null, missing or unparseable is never visible (no lag from `periodEnd` is assumed; `new Date(null)` would otherwise date it 1970). | `server/domain/fundamentals/point-in-time.ts`, `point-in-time.test.ts`, `p2-research-invariants.test.ts` |
| Corporate actions in backtests | Supported by the runner, never supplied by callers; no corporate-action ingestion. | §7 |
| Look-ahead detector | Only tests call it. (Robustness scoring is returned by `strategyOptimisation.getSweep`.) | `look-ahead-detector.ts` |
| In-memory replay engine | Only its test uses it; the replay router has its own DB-backed logic. | `server/modules/strategy-replay/replay-engine.ts`, `server/api/trpc/routers/strategy-replay.ts` |

What production does use: runner-v3, `computeMetrics`, the fee model with the shared statutory schedule, the parameter sweep, the walk-forward engine and sweep robustness scoring, all run by the in-process job runner (`server/plugins/strategy-jobs.ts`).

## 10. Options payoff lab

`/payoff` (`src/routes/_app.payoff.tsx`) prices hand-entered multi-leg option positions. All maths is in `shared/domain/options/` and runs in the browser; there is no server call and no live price.

- **Pricing** (`black-scholes.ts`): European Black-Scholes on a non-dividend underlying, $T$ in calendar days / 365, one IV for every strike. The normal CDF is Hart's double-precision approximation (West, 2005), so the Greeks agree with finite differences of the price. Theta is per calendar day; vega and rho are per percentage point. At or after expiry an option is worth its intrinsic value.
- **Position** (`payoff.ts`): every rupee figure is per-unit value × lots × lot size. Futures are delta-one on the underlying (no cost of carry). The "today" curve and the scenario grid value each leg with Black-Scholes at the shifted IV; the summary Greeks use the entered IV.
- **Expiry profile**: the expiry P&L is piecewise linear in the underlying, bending only at option strikes, and the underlying cannot go below zero. So max profit and max loss are the extremes over {0, strikes} unless the right tail slopes (net units of calls and futures): a positive slope makes profit unlimited, a negative one makes loss unlimited. Breakevens are the exact zero crossings on each segment and in the tail. Nothing is sampled, so an iron condor's max profit is exactly its net credit × lots × lot size.
- **Defaults**: NIFTY 65 / 50, BANKNIFTY 30 / 100, FINNIFTY 60 / 50 (lot size / strike step; lots per NSE circular NSE/FAOP/70616, 3 October 2025), rate 6.5%, IV 14%. Every input is editable.
- **State** (`src/lib/payoff-lab-state.ts`): the route's search schema holds the contract inputs and the legs (`legs=B_CE_24000_1_120~S_PE_23800_1_`: side, type, strike, lots, premium), so a URL reproduces a position; invalid values are dropped rather than failing the page. The last session is kept in localStorage under `maet:payoff-lab` and restored when the URL carries no state.
- **Options chain hand-off**: the chain page's "Open in Payoff Lab" passes the underlying and the public spot quote; clicking a contract's LTP adds it as a bought leg with that LTP as an editable premium. Signed out, the chain is hidden but the link still opens the lab with the underlying and spot.
- **Tests**: `shared/domain/options/black-scholes.test.ts` (textbook price, put-call parity, Greeks vs finite differences), `shared/domain/options/payoff.test.ts` (breakevens, unlimited detection, iron condor max profit, templates, lot defaults), `src/lib/payoff-lab-state.test.ts` (URL and storage round trips, validation) and `tests/e2e/payoff.spec.ts`.
