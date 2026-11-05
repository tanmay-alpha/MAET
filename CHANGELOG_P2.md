# MAET P2 — Research Engine Changelog

## 2026-11-05 — Research correctness fixes

- **Fees**: `VOLUME_AWARE` charges each leg from the shared statutory schedule (`computeIndianEquityCharges`), side-aware, with `exchange` (default NSE), `product` (default DELIVERY) and `brokerage` (INR per order). The per-component bps overrides (`stt`, `exchangeCharges`, `gst`, `sebiCharges`, `stampDuty`) and `timeInForce` are removed. `FEE_MODEL_VERSION` 2.0.0.
- **Portfolio engine**: entries reserve notional + charges from cash (cash reserve and no-leverage limits now bind); spread/slippage/impact counted once; short stops/targets direction-aware with gap fills; entry-bar stops checked.
- **Look-ahead**: sizing, ranking, impact and participation at a bar-i fill use bar i-1 data (`ExecutionContext.referenceVolume`).
- **runner-v3**: `ON_CLOSE` honoured; stops/targets checked on the entry bar; `tradeFrom` warm-up bars.
- **Metrics**: Sharpe = mean(r − rf_p)/std × √P; Sortino downside deviation over all N periods; optional annual `riskFreeRate`; profit factor / payoff ratio are `null` (not Infinity) without losing trades.
- **Walk-forward**: rejected windows are not tested; errors surface as warnings; phases get indicator warm-up; WFE and retention are `null` with a reason when in-sample ≤ 0. The walk-forward worker now runs this engine.
- **Sweeps**: parameters are applied at their `path`; previously every combination ran the unmodified strategy.
- **Corporate actions**: applied oldest-first; BONUS a:b scales prices by b/(a+b).
- **Removed**: `SimulatedOrder` (order-simulator), legacy `backtest/engine.ts`, `runner.ts`, `strategies.ts`, `strategies-v2.ts`, and the unauthenticated `/api/backtest/run` endpoint.

## [P2] 2026-09-16 — Professional-Grade Research & Simulation Engine

### New: Realistic Execution Model (`server/domain/strategy/execution-model.ts`)
- **Spread models**: NONE, FIXED_BPS, VOLATILITY_BASED, LIQUIDITY_BASED
- **Square-root market impact**: `impactBps = coeff × √(participation) × volFactor`
- BUY orders shift price up; SELL orders shift price down — correctly penalising both sides
- **Participation rate cap**: `maxFill = floor(barVolume × maxParticipationRate)`
- Multi-bar order state machine: NEW → PARTIALLY_FILLED → FILLED / EXPIRED / CANCELLED
- Full cost breakdown: brokerage, taxes, spread, slippage, market impact, cost drag %

### New: Corporate-Action Adjusted Historical Data (`server/domain/data/corporate-actions.ts`)
- **Three series**: RAW, SPLIT_ADJUSTED, TOTAL_RETURN_ADJUSTED
- Backward-adjusted OHLCV: split factors applied to all candles strictly before ex-date
- Dividend reinvestment factor: `k = 1 - dividend/priorClose`
- **Financial invariant**: a 2:1 stock split NEVER produces an artificial 50% drawdown

### New: Point-in-Time Fundamentals (`server/domain/fundamentals/point-in-time.ts`)
- `availableFrom <= T` invariant — zero look-ahead bias on financial statements
- Full revision tracking: backtests before restatement see Revision 1, after see Revision 2
- Historical universe membership: survivorship bias prevention with `SURVIVORSHIP_BIAS_POSSIBLE` warnings
- `getActiveUniverseConstituents()` — point-in-time index constituent lookup

### New: Multi-Symbol Portfolio Backtest Engine (`server/domain/strategy/portfolio-engine.ts`)
- Synchronized bar-by-bar timeline across all instruments
- **Shared cash pool**: symbols compete for capital — capital cannot be double-spent
- Deterministic signal ranking: MOMENTUM, RELATIVE_VOLUME, SCORECARD_SCORE, SYMBOL_ASCENDING
- Portfolio constraints: maximumOpenPositions, maximumPositionPercent, maximumGrossExposurePercent, maximumSectorExposurePercent, cashReservePercent
- Rebalancing schedules: DAILY, WEEKLY, MONTHLY, SIGNAL_DRIVEN (sells before buys)
- Full portfolio attribution: PnL by symbol, sector, month, reason
- Institutional metrics: CAGR, Sharpe, Sortino, MaxDrawdown, Calmar, Turnover, Cost Drag, Beta, Alpha
- Benchmark comparison curve + tracking error
- Reproducibility hash for deterministic run verification

### New: Walk-Forward Analysis Engine (`server/domain/strategy/walk-forward.ts`)
- 3-phase windows: Training → Validation → Test
- **Zero-leakage invariants**: test candles never enter training or validation indicator caches
- Parameter sweep across each training window, parameter selection on validation
- OOS equity curve concatenation across all test windows
- Walk-Forward Efficiency ratio, performance retention, OOS Sharpe, OOS drawdown

### New: Parameter Robustness Analysis (`server/domain/strategy/robustness.ts`)
- Neighbor stability scoring (adjacent parameter values must sustain performance)
- Overfit detection: fragile spike = best params score >> all neighbors
- Robustness score 0–100 (weighted: neighbor stability 40%, sample size 25%, drawdown 20%, cost drag 15%)
- Safeguard flags: LOW_SAMPLE_SIZE, OVERFIT_RISK, PARAMETER_INSTABILITY, HIGH_COST_DRAG
- 2D parameter heatmap matrix for UI visualization

### New: Analytics UI Components
- `PortfolioAnalyticsView` — equity curve, drawdown, sector exposure, cost drag, monthly returns, top/bottom contributors
- `WalkForwardView` — aggregate OOS equity curve, per-window OOS/IS breakdown table, OOS vs IS scatter
- `RobustnessHeatmapView` — 2D parameter sensitivity heatmap, robustness score, safeguard flags

### DB Schema & Migration (`0022_p2_research_engine.sql`)
- `universe_membership` table with point-in-time constituent tracking
- `corporate_actions` table: currency, source, source_reference, ingested_at columns
- `fundamentals` table: filing_date, available_from, revision columns
- `strategy_backtest_jobs`: execution_model_config, reproducibility_metadata, warnings
- `strategy_walk_forward_windows`: test_from, test_to, test_metrics columns

### New: P2 Research Invariant Test Suite (`p2-research-invariants.test.ts`)
- 8 deterministic tests across all P2 pillars — 0 DB, 0 network dependencies
- Square-root market impact scaling verified to ±0.1 Sharpe precision
- Corporate action split invariant: no artificial drawdown on price discontinuity
- Point-in-time isolation: revision 1 vs revision 2 visible at correct timestamps
- Survivorship bias: YESBANK absent from 2021 universe, present in 2019 universe
- Shared capital: INFY + TCS cannot double-spend portfolio capital
- Walk-forward OOS isolation verified end-to-end
- Fragile spike detection: peak Sharpe 3.0 surrounded by 0.2 neighbors → OVERFIT_RISK flag
