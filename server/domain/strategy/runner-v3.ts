/**
 * Backtest Engine V3 — AST-based strategy runner.
 *
 * This is an extension to runner.ts that accepts StrategyVersion (AST) definitions.
 * Reuses the same risk-metrics.ts for metric computation.
 *
 * Key properties:
 * - NEXT_BAR_OPEN fill policy (default): signal on bar i, fill on open of bar i+1
 * - CONSERVATIVE intrabar stop/target policy: stop checked first on both sides
 * - Full look-ahead protection via IndicatorStateCache
 * - Trade records include MFE, MAE, entry/exit reason, fees, slippage, netPnl
 * - Deterministic: identical strategy + candles = identical results
 * - Reproducibility hash: SHA-256 of canonical candle inputs
 */

import { createHash } from "crypto";
import type { Candle } from "@shared/types";
import type { StrategyDefinition, StrategyRiskConfig, StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { IndicatorStateCache } from "./indicator-state";
import { evaluateRuleGroup } from "./ast-evaluator";
import { calculatePositionSize } from "./position-sizer";
import { computeFeeRate } from "./fee-model";
import { computeMetrics } from "../backtest/risk-metrics";
import type { EquityPoint, TradeRecord } from "../backtest/risk-metrics";
import { STRATEGY_ENGINE_VERSION, INDICATOR_ENGINE_VERSION, FEE_MODEL_VERSION } from "../../../shared/strategy/version";

import {
  adjustCandles,
  type CorporateAction,
  type PriceAdjustmentSeries,
} from "../data/corporate-actions";

// ============================================================
// Types
// ============================================================

export interface V3BacktestRunRequest {
  strategyVersionId: string;
  definition: StrategyDefinition;
  symbol: string;
  candles: Candle[];
  benchmarkCandles?: Candle[];
  overrideCapital?: number;
  timeframe?: string;
  corporateActions?: CorporateAction[];
  priceSeries?: PriceAdjustmentSeries;
}

export interface V3TradeRecord extends TradeRecord {
  direction: "long" | "short";
  entrySignalBar: number;
  entryBar: number;
  exitBar: number;
  entryReason: string;
  exitReason: string;
  grossPnl: number;
  fees: number;
  slippage: number;
  netPnl: number;
  mfe: number;
  mae: number;
  holdingBars: number;
  entrySignalTimestamp: number;
  entryFees: number;
  exitFees: number;
  totalFees: number;
  entrySlippage: number;
  exitSlippage: number;
  totalSlippage: number;
  grossReturn: number;
  netReturn: number;
  quantity: number;
  spreadCost?: number;
  marketImpactCost?: number;
  totalTransactionCost?: number;
}

export interface V3BacktestRunResult {
  runId: string;
  strategyVersionId: string;
  symbol: string;
  from: string;
  to: string;
  metrics: ReturnType<typeof computeMetrics>;
  equityCurve: EquityPoint[];
  benchmarkCurve?: EquityPoint[];
  trades: V3TradeRecord[];
  tradeCount: number;
  longTradeCount: number;
  shortTradeCount: number;
  feesPaid: number;
  slippageCost: number;
  spreadCost?: number;
  marketImpactCost?: number;
  totalTransactionCost?: number;
  grossPnl?: number;
  netPnl?: number;
  costDragPercent?: number;
  priceSeries?: PriceAdjustmentSeries;
  corporateActionCount?: number;
  insufficientHistory: boolean;
  dataHash: string;
  engineVersion: string;
  indicatorVersion: string;
  feeModelVersion: string;
  executionPolicy: string;
  intrabarPolicy: string;
  warnings: string[];
}

export class InsufficientHistoryV3Error extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient history: required ${required} bars, got ${available}`);
    this.name = "InsufficientHistoryV3Error";
  }
}

// Counter for deterministic fallback run IDs (used when crypto.randomUUID unavailable)
let _runCounter = 0;

// ============================================================
// Data hash for reproducibility
// ============================================================

function computeDataHash(candles: Candle[]): string {
  const canonical = candles.map((c) =>
    `${c.ts}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume ?? 0}`
  ).join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// ============================================================
// Main V3 runner
// ============================================================

export function runBacktestV3(request: V3BacktestRunRequest): V3BacktestRunResult {
  const { definition } = request;
  const priceSeries = request.priceSeries ?? "SPLIT_ADJUSTED";
  const processedCandles = request.corporateActions?.length
    ? adjustCandles(request.candles, request.corporateActions, priceSeries)
    : request.candles;
  const sorted = [...processedCandles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const warnings: string[] = [];

  // Minimum candle requirement
  const minBars = 50;
  if (sorted.length < minBars) {
    throw new InsufficientHistoryV3Error(minBars, sorted.length);
  }

  const runId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `run-${Date.now().toString(36)}-${(++_runCounter).toString(36)}`;
  const dataHash = computeDataHash(sorted);

  const risk: StrategyRiskConfig = {
    sizingMethod: "PERCENT_OF_EQUITY",
    sizeValue: 100,
    maximumOpenPositions: 1,
    allowPyramiding: false,
    ...(definition.risk ?? {}),
  };
  const exec: StrategyExecutionConfig = definition.execution ?? ({ initialCapital: 100000 } as any);
  const initialCapital = request.overrideCapital ?? exec.initialCapital;

  // Build indicator state cache
  const cache = new IndicatorStateCache(sorted);

  // ============================================================
  // Simulation loop
  // ============================================================

  const trades: V3TradeRecord[] = [];
  let inPosition = false;
  let direction: "long" | "short" = "long";
  let entrySignalBar = 0;
  let entryBar = 0;
  let entryPrice = 0;
  let entrySignalTimestamp = 0;
  let quantity = 0;
  let peakPrice = 0;
  let troughPrice = Infinity;
  let mfe = 0;
  let mae = 0;
  let entryReason = "";
  let equity = initialCapital;
  let currentEntryFees = 0;
  let currentEntrySlippage = 0;
  let cooldownBarsRemaining = 0;
  const cooldown = risk.cooldownBars ?? 0;
  const slippageBps = exec.slippageBps ?? 5;
  const slippageRate = slippageBps / 10000;

  const equityCurve: EquityPoint[] = [{ timestamp: new Date(sorted[0].ts).getTime(), equity }];

  // Helper: compute mark-to-market equity for the current open position at a given price.
  // The `equity` variable tracks realized cash minus costs (entry fees/slippage deducted on entry,
  // exit PnL added on exit). For the equity curve we add the unrealized MTM on each bar.
  // This is purely for the curve — it does NOT mutate `equity` between trade boundaries.
  const mtmEquity = (closePrice: number): number => {
    if (!inPosition) return equity;
    const unrealized = direction === "long"
      ? quantity * (closePrice - entryPrice)
      : quantity * (entryPrice - closePrice);
    return equity + unrealized;
  };

  const getFeeRate = (val: number) => computeFeeRate(exec, val).feeRate;

  for (let i = 1; i < sorted.length; i++) {
    const bar = sorted[i];
    const barTs = new Date(bar.ts).getTime();
    const prevBar = sorted[i - 1];

    // Evaluate AST entry/exit signals on PREVIOUS bar (i-1) for NEXT_BAR_OPEN execution on bar i
    const entryGroup = definition.entry ?? definition.entryRules;
    const exitGroup = definition.exit ?? definition.exitRules;

    const prevEntryEval = !inPosition && cooldownBarsRemaining === 0
      ? evaluateRuleGroup(entryGroup, cache, i - 1)
      : { matched: false };

    const prevExitEval = inPosition
      ? evaluateRuleGroup(exitGroup, cache, i - 1)
      : { matched: false };

    if (inPosition) {
      const currClose = bar.close;
      const currHigh = bar.high;
      const currLow = bar.low;

      // Track MFE/MAE (maximum favourable/adverse excursion from entry)
      if (direction === "long") {
        mfe = Math.max(mfe, (currHigh - entryPrice) / entryPrice);
        mae = Math.max(mae, (entryPrice - currLow) / entryPrice);
      } else {
        mfe = Math.max(mfe, (entryPrice - currLow) / entryPrice);
        mae = Math.max(mae, (currHigh - entryPrice) / entryPrice);
      }

      // ---- Intrabar stop/target check (CONSERVATIVE policy: stop checked first) ----
      let exitReason = "";
      let exitPrice = 0;

      const stopPct = risk.stopLossPercent;
      const targetPct = risk.takeProfitPercent;
      const trailingPct = risk.trailingStopPercent;

      if (direction === "long") {
        const stopLevel = stopPct ? entryPrice * (1 - stopPct / 100) : null;
        const targetLevel = targetPct ? entryPrice * (1 + targetPct / 100) : null;

        // Trailing stop: conservative gap-aware check
        if (trailingPct) {
          const priorTrailLevel = peakPrice > 0 ? peakPrice * (1 - trailingPct / 100) : null;
          peakPrice = Math.max(peakPrice, currHigh);
          const effectiveTrailLevel = priorTrailLevel ?? (peakPrice * (1 - trailingPct / 100));

          if (bar.open <= effectiveTrailLevel) {
            exitPrice = bar.open; // gapped down through trailing stop
            exitReason = `trailing_stop:${trailingPct}%`;
          } else if (currLow <= effectiveTrailLevel) {
            exitPrice = effectiveTrailLevel; // intrabar hit
            exitReason = `trailing_stop:${trailingPct}%`;
          }
        }

        // CONSERVATIVE: stop loss checked first
        if (!exitReason && stopLevel) {
          if (bar.open <= stopLevel) {
            exitPrice = bar.open; // gapped down through stop
            exitReason = `stop_loss:${stopPct}%`;
          } else if (currLow <= stopLevel) {
            exitPrice = stopLevel; // intrabar hit (fills at stopLevel, NOT currLow!)
            exitReason = `stop_loss:${stopPct}%`;
          }
        }

        // Target checked next
        if (!exitReason && targetLevel) {
          if (bar.open >= targetLevel) {
            exitPrice = bar.open; // gapped up above target
            exitReason = `take_profit:${targetPct}%`;
          } else if (currHigh >= targetLevel) {
            exitPrice = targetLevel; // intrabar hit
            exitReason = `take_profit:${targetPct}%`;
          }
        }

        // AST exit rule (evaluated at i-1, fills on bar i open)
        if (!exitReason && prevExitEval.matched) {
          exitPrice = bar.open;
          exitReason = "exit_rule";
        }

      } else {
        // Short position
        const stopLevel = stopPct ? entryPrice * (1 + stopPct / 100) : null;
        const targetLevel = targetPct ? entryPrice * (1 - targetPct / 100) : null;

        // Trailing stop for short
        if (trailingPct) {
          const priorTrailLevel = troughPrice < Infinity ? troughPrice * (1 + trailingPct / 100) : null;
          troughPrice = Math.min(troughPrice, currLow);
          const effectiveTrailLevel = priorTrailLevel ?? (troughPrice * (1 + trailingPct / 100));

          if (bar.open >= effectiveTrailLevel) {
            exitPrice = bar.open; // gapped up through trailing stop
            exitReason = `trailing_stop:${trailingPct}%`;
          } else if (currHigh >= effectiveTrailLevel) {
            exitPrice = effectiveTrailLevel; // intrabar hit
            exitReason = `trailing_stop:${trailingPct}%`;
          }
        }

        // CONSERVATIVE: stop loss checked first
        if (!exitReason && stopLevel) {
          if (bar.open >= stopLevel) {
            exitPrice = bar.open; // gapped up through stop
            exitReason = `stop_loss:${stopPct}%`;
          } else if (currHigh >= stopLevel) {
            exitPrice = stopLevel; // intrabar hit (fills at stopLevel, NOT currHigh!)
            exitReason = `stop_loss:${stopPct}%`;
          }
        }

        // Target checked next
        if (!exitReason && targetLevel) {
          if (bar.open <= targetLevel) {
            exitPrice = bar.open; // gapped down below target
            exitReason = `take_profit:${targetPct}%`;
          } else if (currLow <= targetLevel) {
            exitPrice = targetLevel; // intrabar hit
            exitReason = `take_profit:${targetPct}%`;
          }
        }

        // AST exit rule (evaluated at i-1, fills on bar i open)
        if (!exitReason && prevExitEval.matched) {
          exitPrice = bar.open;
          exitReason = "exit_rule";
        }
      }

      // Execute exit
      if (exitReason && exitPrice > 0) {
        const exitNotional = quantity * exitPrice;
        const exitFeeRate = getFeeRate(exitNotional);
        const exitFees = exitNotional * exitFeeRate;
        const exitSlippage = exitNotional * slippageRate;

        const totalFees = currentEntryFees + exitFees;
        const totalSlippage = currentEntrySlippage + exitSlippage;

        let grossPnl: number;
        if (direction === "long") {
          grossPnl = quantity * (exitPrice - entryPrice);
        } else {
          grossPnl = quantity * (entryPrice - exitPrice);
        }
        const entryNotional = quantity * entryPrice;
        const grossReturn = entryNotional > 0 ? grossPnl / entryNotional : 0;
        const netPnl = grossPnl - totalFees - totalSlippage;
        const netReturn = entryNotional > 0 ? netPnl / entryNotional : 0;

        // Cash adjustment: entry costs were deducted on entry. On exit, add grossPnl - exit costs.
        // Total change in equity for this trade is: - (entryFees + entrySlippage) + (grossPnl - exitFees - exitSlippage) = netPnl.
        equity += grossPnl - exitFees - exitSlippage;

        trades.push({
          direction,
          entrySignalBar,
          entryBar,
          exitBar: i,
          entrySignalTimestamp,
          entryTimestamp: new Date(sorted[entryBar].ts).getTime(),
          exitTimestamp: barTs,
          entryPrice,
          exitPrice,
          quantity,
          side: direction === "long" ? "long" : "short",
          return: netReturn,
          grossReturn,
          netReturn,
          entryReason,
          exitReason,
          grossPnl,
          entryFees: currentEntryFees,
          exitFees,
          totalFees,
          fees: totalFees,
          entrySlippage: currentEntrySlippage,
          exitSlippage,
          totalSlippage,
          slippage: totalSlippage,
          netPnl,
          mfe,
          mae,
          holdingBars: i - entryBar,
        });

        inPosition = false;
        currentEntryFees = 0;
        currentEntrySlippage = 0;
        cooldownBarsRemaining = cooldown;
        peakPrice = 0;
        troughPrice = Infinity;
        mfe = 0;
        mae = 0;
      }
    }

    // Decrement cooldown
    if (cooldownBarsRemaining > 0) cooldownBarsRemaining--;

    // ---- Entry signal (evaluated at i-1, fills on bar i open) ----
    if (!inPosition && cooldownBarsRemaining === 0) {
      if (prevEntryEval.matched) {
        // Fill on this bar's open (NEXT_BAR_OPEN: signal was on prev bar i-1)
        const fillPrice = bar.open;

        const sizing = calculatePositionSize(risk, {
          currentEquity: equity,
          entryPrice: fillPrice,
          atr: cache.resolve("ATR", { period: 14 }, i) ?? undefined,
          stopPrice: risk.stopLossPercent ? fillPrice * (1 - risk.stopLossPercent / 100) : undefined,
        });

        if (sizing.quantity > 0 && sizing.capitalRequired <= equity) {
          const entryNotional = sizing.quantity * fillPrice;
          const entryFeeRate = getFeeRate(entryNotional);
          const entryFees = entryNotional * entryFeeRate;
          const entrySlippage = entryNotional * slippageRate;

          equity -= entryFees + entrySlippage;
          currentEntryFees = entryFees;
          currentEntrySlippage = entrySlippage;
          inPosition = true;
          direction = definition.direction === "SHORT_ONLY" ? "short" : "long";
          entrySignalBar = i - 1;
          entryBar = i;
          entryPrice = fillPrice;
          entrySignalTimestamp = new Date(prevBar.ts).getTime();
          quantity = sizing.quantity;
          peakPrice = fillPrice;
          troughPrice = fillPrice;
          mfe = 0;
          mae = 0;
          entryReason = "entry_rule";
        }
      }
    }

    // P0-C fix: Push equity curve point using mark-to-market value so the curve reflects
    // unrealized gains/losses on open positions. Without this, the curve is flat between
    // entry and exit, causing drawdown metrics to miss intra-trade adverse excursions.
    equityCurve.push({ timestamp: barTs, equity: mtmEquity(bar.close) });
  }

  // Force-close open position at last bar with full fee and slippage model applied
  if (inPosition) {
    const last = sorted[sorted.length - 1];
    const exitPrice = last.close;
    const lastTs = new Date(last.ts).getTime();
    const exitNotional = quantity * exitPrice;
    const exitFeeRate = getFeeRate(exitNotional);
    const exitFees = exitNotional * exitFeeRate;
    const exitSlippage = exitNotional * slippageRate;

    const totalFees = currentEntryFees + exitFees;
    const totalSlippage = currentEntrySlippage + exitSlippage;

    let grossPnl = direction === "long"
      ? quantity * (exitPrice - entryPrice)
      : quantity * (entryPrice - exitPrice);
    const entryNotional = quantity * entryPrice;
    const grossReturn = entryNotional > 0 ? grossPnl / entryNotional : 0;
    const netPnl = grossPnl - totalFees - totalSlippage;
    const netReturn = entryNotional > 0 ? netPnl / entryNotional : 0;

    equity += grossPnl - exitFees - exitSlippage;

    trades.push({
      direction,
      entrySignalBar,
      entryBar,
      exitBar: sorted.length - 1,
      entrySignalTimestamp,
      entryTimestamp: new Date(sorted[entryBar].ts).getTime(),
      exitTimestamp: lastTs,
      entryPrice,
      exitPrice,
      quantity,
      side: direction === "long" ? "long" : "short",
      return: netReturn,
      grossReturn,
      netReturn,
      entryReason,
      exitReason: "end_of_period",
      grossPnl,
      entryFees: currentEntryFees,
      exitFees,
      totalFees,
      fees: totalFees,
      entrySlippage: currentEntrySlippage,
      exitSlippage,
      totalSlippage,
      slippage: totalSlippage,
      netPnl,
      mfe,
      mae,
      holdingBars: sorted.length - 1 - entryBar,
    });

    equityCurve[equityCurve.length - 1] = { timestamp: lastTs, equity };
  }

  // Benchmark curve
  let benchmarkCurve: EquityPoint[] | undefined;
  if (request.benchmarkCandles?.length) {
    const sortedBench = [...request.benchmarkCandles].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    const firstTs = new Date(sorted[0].ts).getTime();
    const lastTs = new Date(sorted[sorted.length - 1].ts).getTime();
    const benchStart = sortedBench.find((c) => new Date(c.ts).getTime() >= firstTs);
    if (benchStart) {
      benchmarkCurve = sortedBench
        .filter((c) => new Date(c.ts).getTime() >= firstTs && new Date(c.ts).getTime() <= lastTs)
        .map((c) => ({ timestamp: new Date(c.ts).getTime(), equity: initialCapital * (c.close / benchStart.close) }));
    }
  }

  const timeframe = request.timeframe ?? (sorted[0].tf as string) ?? definition.timeframe ?? "1d";
  const metrics = computeMetrics(equityCurve, trades, benchmarkCurve, timeframe);
  const feesPaid = trades.reduce((s, t) => s + t.totalFees, 0);
  const slippageCost = trades.reduce((s, t) => s + t.totalSlippage, 0);
  const spreadCost = trades.reduce((s, t) => s + (t.spreadCost ?? 0), 0);
  const marketImpactCost = trades.reduce((s, t) => s + (t.marketImpactCost ?? 0), 0);
  const totalTransactionCost = trades.reduce(
    (s, t) => s + (t.totalTransactionCost ?? (t.totalFees + t.totalSlippage)),
    0,
  );
  const grossPnl = trades.reduce((s, t) => s + t.grossPnl, 0);
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const costDragPercent = grossPnl > 0 ? (totalTransactionCost / grossPnl) * 100 : 0;

  return {
    runId,
    strategyVersionId: request.strategyVersionId,
    symbol: request.symbol,
    from: sorted[0].ts,
    to: sorted[sorted.length - 1].ts,
    metrics,
    equityCurve,
    benchmarkCurve,
    trades,
    tradeCount: trades.length,
    longTradeCount: trades.filter((t) => t.direction === "long").length,
    shortTradeCount: trades.filter((t) => t.direction === "short").length,
    feesPaid,
    slippageCost,
    spreadCost,
    marketImpactCost,
    totalTransactionCost,
    grossPnl,
    netPnl,
    costDragPercent,
    priceSeries,
    corporateActionCount: request.corporateActions?.length ?? 0,
    insufficientHistory: false,
    dataHash,
    engineVersion: STRATEGY_ENGINE_VERSION,
    indicatorVersion: INDICATOR_ENGINE_VERSION,
    feeModelVersion: FEE_MODEL_VERSION,
    executionPolicy: exec.fillPolicy,
    intrabarPolicy: exec.intrabarPolicy,
    warnings,
  };
}
