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
import {
  DEFAULT_INITIAL_CAPITAL_INR,
  type StrategyDefinition,
  type StrategyRiskConfig,
  type StrategyExecutionConfig,
} from "../../../shared/strategy/ast";
import { IndicatorStateCache } from "./indicator-state";
import { evaluateRuleGroup } from "./ast-evaluator";
import { calculatePositionSize } from "./position-sizer";
import { computeLegCharges } from "./fee-model";
import { computeMetrics } from "../backtest/risk-metrics";
import type { EquityPoint, TradeRecord } from "../backtest/risk-metrics";
import { STRATEGY_ENGINE_VERSION, FEE_MODEL_VERSION } from "../../../shared/strategy/version";
import { INDICATOR_ENGINE_VERSION } from "../../../shared/indicators/canonical";

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
  /**
   * Bars before this timestamp only warm up indicators: no signals act on them and they are not
   * part of the equity curve or metrics. Default: trade from the second bar.
   */
  tradeFrom?: string | number;
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
  const exec: StrategyExecutionConfig = definition.execution ?? ({ initialCapital: DEFAULT_INITIAL_CAPITAL_INR } as any);
  const initialCapital = request.overrideCapital ?? exec.initialCapital;

  // Build indicator state cache
  const cache = new IndicatorStateCache(sorted);

  // ============================================================
  // Simulation loop
  // ============================================================

  const trades: V3TradeRecord[] = [];
  const onClose = exec.fillPolicy === "ON_CLOSE";
  const entryGroup = definition.entry ?? definition.entryRules;
  const exitGroup = definition.exit ?? definition.exitRules;
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

  // First bar on which orders may fill; the bar before it is the equity curve's starting mark.
  const tradeFromMs = request.tradeFrom === undefined ? null : new Date(request.tradeFrom).getTime();
  const firstTradeBar = tradeFromMs === null
    ? 1
    : Math.max(1, sorted.findIndex((c) => new Date(c.ts).getTime() >= tradeFromMs));
  if (tradeFromMs !== null && new Date(sorted[sorted.length - 1].ts).getTime() < tradeFromMs) {
    throw new Error(`tradeFrom ${new Date(tradeFromMs).toISOString()} is after the last candle`);
  }
  const startBar = sorted[firstTradeBar - 1];

  const equityCurve: EquityPoint[] = [{ timestamp: new Date(startBar.ts).getTime(), equity }];

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

  /**
   * Tracks MFE/MAE over `bar` and checks the protective exits in CONSERVATIVE order: trailing
   * stop, stop loss, then take profit. A bar that opens beyond a level fills at the open (gap);
   * otherwise the level itself fills.
   */
  function protectiveExit(bar: Candle): { price: number; reason: string } | null {
    const { open, high, low } = bar;
    const isLong = direction === "long";
    mfe = Math.max(mfe, (isLong ? high - entryPrice : entryPrice - low) / entryPrice);
    mae = Math.max(mae, (isLong ? entryPrice - low : high - entryPrice) / entryPrice);

    const trailingPct = risk.trailingStopPercent;
    if (trailingPct) {
      const reason = `trailing_stop:${trailingPct}%`;
      if (isLong) {
        const priorTrailLevel = peakPrice > 0 ? peakPrice * (1 - trailingPct / 100) : null;
        peakPrice = Math.max(peakPrice, high);
        const level = priorTrailLevel ?? peakPrice * (1 - trailingPct / 100);
        if (open <= level) return { price: open, reason };
        if (low <= level) return { price: level, reason };
      } else {
        const priorTrailLevel = troughPrice < Infinity ? troughPrice * (1 + trailingPct / 100) : null;
        troughPrice = Math.min(troughPrice, low);
        const level = priorTrailLevel ?? troughPrice * (1 + trailingPct / 100);
        if (open >= level) return { price: open, reason };
        if (high >= level) return { price: level, reason };
      }
    }

    const stopPct = risk.stopLossPercent;
    if (stopPct) {
      const reason = `stop_loss:${stopPct}%`;
      const level = entryPrice * (isLong ? 1 - stopPct / 100 : 1 + stopPct / 100);
      if (isLong ? open <= level : open >= level) return { price: open, reason };
      if (isLong ? low <= level : high >= level) return { price: level, reason };
    }

    const targetPct = risk.takeProfitPercent;
    if (targetPct) {
      const reason = `take_profit:${targetPct}%`;
      const level = entryPrice * (isLong ? 1 + targetPct / 100 : 1 - targetPct / 100);
      if (isLong ? open >= level : open <= level) return { price: open, reason };
      if (isLong ? high >= level : low <= level) return { price: level, reason };
    }

    return null;
  }

  function closeTrade(exitBar: number, exitPrice: number, exitReason: string) {
    const exitNotional = quantity * exitPrice;
    // Closing leg: a long sells, a short buys back.
    const exitFees = computeLegCharges(exec, direction === "long" ? "SELL" : "BUY", exitNotional).total;
    const exitSlippage = exitNotional * slippageRate;

    const totalFees = currentEntryFees + exitFees;
    const totalSlippage = currentEntrySlippage + exitSlippage;

    const grossPnl = direction === "long"
      ? quantity * (exitPrice - entryPrice)
      : quantity * (entryPrice - exitPrice);
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
      exitBar,
      entrySignalTimestamp,
      entryTimestamp: new Date(sorted[entryBar].ts).getTime(),
      exitTimestamp: new Date(sorted[exitBar].ts).getTime(),
      entryPrice,
      exitPrice,
      quantity,
      side: direction,
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
      holdingBars: exitBar - entryBar,
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

  for (let i = firstTradeBar; i < sorted.length; i++) {
    const bar = sorted[i];
    const barTs = new Date(bar.ts).getTime();

    // NEXT_BAR_OPEN acts at this bar's open on rules evaluated at bar i-1.
    // ON_CLOSE acts at this bar's close on rules evaluated at bar i.
    const signalIdx = onClose ? i : i - 1;
    const fillPrice = onClose ? bar.close : bar.open;
    // A position closed on this bar cannot re-enter on the same bar.
    const canEnter = !inPosition && cooldownBarsRemaining === 0;

    if (inPosition) {
      // Events in bar order: a NEXT_BAR_OPEN exit rule (decided on bar i-1) fills at the open,
      // before the stops and targets the rest of the bar could trigger; an ON_CLOSE exit rule
      // fills at the close, after them.
      const ruleExit = evaluateRuleGroup(exitGroup, cache, signalIdx).matched
        ? { price: fillPrice, reason: "exit_rule" }
        : null;
      const exit = (!onClose && ruleExit) || protectiveExit(bar) || ruleExit;
      if (exit && exit.price > 0) {
        closeTrade(i, exit.price, exit.reason);
      }
    }

    // Decrement cooldown
    if (cooldownBarsRemaining > 0) cooldownBarsRemaining--;

    if (canEnter && cooldownBarsRemaining === 0 && evaluateRuleGroup(entryGroup, cache, signalIdx).matched) {
      const entryDirection = definition.direction === "SHORT_ONLY" ? "short" : "long";
      const stopPct = risk.stopLossPercent;
      // Sizing may only use data through the signal bar: for NEXT_BAR_OPEN that is bar i-1.
      const sizing = calculatePositionSize(risk, {
        currentEquity: equity,
        entryPrice: fillPrice,
        atr: cache.resolve("ATR", { period: 14 }, signalIdx) ?? undefined,
        stopPrice: stopPct ? fillPrice * (entryDirection === "long" ? 1 - stopPct / 100 : 1 + stopPct / 100) : undefined,
      });

      if (sizing.quantity > 0 && sizing.capitalRequired <= equity) {
        const entryNotional = sizing.quantity * fillPrice;
        const entryFees = computeLegCharges(exec, entryDirection === "long" ? "BUY" : "SELL", entryNotional).total;
        const entrySlippage = entryNotional * slippageRate;

        equity -= entryFees + entrySlippage;
        currentEntryFees = entryFees;
        currentEntrySlippage = entrySlippage;
        inPosition = true;
        direction = entryDirection;
        entrySignalBar = signalIdx;
        entryBar = i;
        entryPrice = fillPrice;
        entrySignalTimestamp = new Date(sorted[signalIdx].ts).getTime();
        quantity = sizing.quantity;
        peakPrice = fillPrice;
        troughPrice = fillPrice;
        mfe = 0;
        mae = 0;
        entryReason = "entry_rule";

        // After an open fill the rest of the bar still trades: stops and targets apply to it.
        if (!onClose) {
          const exit = protectiveExit(bar);
          if (exit) closeTrade(i, exit.price, exit.reason);
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
    const lastIndex = sorted.length - 1;
    closeTrade(lastIndex, sorted[lastIndex].close, "end_of_period");
    equityCurve[equityCurve.length - 1] = { timestamp: new Date(sorted[lastIndex].ts).getTime(), equity };
  }

  // Benchmark curve
  let benchmarkCurve: EquityPoint[] | undefined;
  if (request.benchmarkCandles?.length) {
    const sortedBench = [...request.benchmarkCandles].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    const firstTs = new Date(startBar.ts).getTime();
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
    from: startBar.ts,
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
