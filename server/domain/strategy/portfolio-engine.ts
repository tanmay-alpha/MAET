/**
 * Multi-Symbol Shared Capital Portfolio Simulation Engine — MAET P2.
 *
 * Implements an institutional-grade portfolio backtest engine:
 * 1. Synchronized chronological timeline across multiple instruments.
 * 2. Shared cash pool and continuous mark-to-market portfolio equity.
 * 3. Competing symbol allocation: symbols compete for capital; capital cannot be double-spent.
 * 4. Deterministic signal ranking: MOMENTUM, RELATIVE_VOLUME, SCORECARD_SCORE, SYMBOL_ASCENDING.
 * 5. Portfolio allocation constraints: maximumOpenPositions, maximumPositionPercent,
 *    maximumGrossExposurePercent, maximumSectorExposurePercent, cashReservePercent.
 * 6. Rebalancing schedules: DAILY, WEEKLY, MONTHLY, SIGNAL_DRIVEN (sells precede buys).
 * 7. Comprehensive portfolio attribution: PnL by symbol, sector, month, reason.
 * 8. Institutional risk metrics: CAGR, Sharpe, Sortino, Max Drawdown, Calmar, Turnover, Cost Drag,
 *    Beta, Alpha, Tracking Error, Correlation against benchmark.
 */

import { createHash } from "crypto";
import type { Candle } from "@shared/types";
import { canonicalJson, type StrategyDefinition } from "../../../shared/strategy/ast";
import { ExecutionModel, type ExecutionContext, type FillRejectionReason, type SingleFillResult } from "./execution-model";
import { adjustCandles, type CorporateAction, type PriceAdjustmentSeries } from "../data/corporate-actions";
import { IndicatorStateCache } from "./indicator-state";
import { evaluateRuleGroup } from "./ast-evaluator";
import { calculatePositionSize } from "./position-sizer";
import { computeMetrics, type EquityPoint } from "../backtest/risk-metrics";

// ============================================================
// Types
// ============================================================

export type RebalanceSchedule = "DAILY" | "WEEKLY" | "MONTHLY" | "SIGNAL_DRIVEN";
export type SignalRankingMethod = "MOMENTUM" | "RELATIVE_VOLUME" | "SCORECARD_SCORE" | "SYMBOL_ASCENDING";

export interface PortfolioPosition {
  symbol: string;
  direction: "long" | "short";
  quantity: number;
  /** Fill price including spread, slippage and impact. */
  entryPrice: number;
  /** Pre-friction reference price (the bar open) the entry order was priced from. */
  entryReferencePrice: number;
  entryTimestamp: number;
  currentPrice: number;
  notional: number;
  unrealizedPnl: number;
  sector: string;
  entryReason?: string;
  stopPrice?: number;
  targetPrice?: number;
  entryFees: number;
  entrySlippage: number;
  entrySpreadCost: number;
  entryImpactCost: number;
}

export interface PortfolioConstraints {
  maximumOpenPositions?: number;
  maximumPositionPercent?: number;
  maximumGrossExposurePercent?: number;
  maximumSectorExposurePercent?: number;
  cashReservePercent?: number;
}

export interface PortfolioEngineInput {
  strategyVersionId: string;
  definition: StrategyDefinition;
  symbolCandles: Record<string, Candle[]>;
  benchmarkCandles?: Candle[];
  initialCapital?: number;
  constraints?: PortfolioConstraints;
  rankingMethod?: SignalRankingMethod;
  rebalanceSchedule?: RebalanceSchedule;
  symbolSectors?: Record<string, string>;
  corporateActions?: Record<string, CorporateAction[]>;
  priceSeries?: PriceAdjustmentSeries;
}

export interface PortfolioTradeRecord {
  symbol: string;
  direction: "long" | "short";
  entryTimestamp: number;
  entryPrice: number;
  exitTimestamp: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  spreadCost: number;
  marketImpactCost: number;
  totalCosts: number;
  netPnl: number;
  returnPercent: number;
  entryReason: string;
  exitReason: string;
  sector: string;
}

export interface PortfolioAttribution {
  pnlBySymbol: Record<string, { grossPnl: number; netPnl: number; tradeCount: number; transactionCosts: number }>;
  pnlBySector: Record<string, { grossPnl: number; netPnl: number; tradeCount: number }>;
  pnlByMonth: Record<string, number>;
  pnlByReason: Record<string, number>;
}

export interface PortfolioBacktestResult {
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  /** null when there were no losing trades (see risk-metrics). */
  profitFactor: number | null;
  tradeCount: number;
  grossPnl: number;
  netPnl: number;
  totalTransactionCosts: number;
  costDragPercent: number;
  turnover: number;
  exposure: number; // average gross exposure %
  equityCurve: EquityPoint[];
  drawdownCurve: { timestamp: number; drawdown: number }[];
  benchmarkCurve?: EquityPoint[];
  trades: PortfolioTradeRecord[];
  attribution: PortfolioAttribution;
  excludedSignalsCount: number;
  /** excludedSignalsCount broken down by the reason each entry signal was not filled. */
  excludedSignalsByReason: Partial<Record<ExcludedSignalReason, number>>;
  warnings: string[];
  /** SHA-256 (hex) of the canonical configuration and input data. */
  reproducibilityHash: string;
}

/** Why an entry signal was not filled. */
export type ExcludedSignalReason =
  | "MAX_OPEN_POSITIONS"
  | "NON_POSITIVE_EQUITY"
  | "SECTOR_EXPOSURE_CAP"
  | "GROSS_EXPOSURE_CAP"
  | "INSUFFICIENT_CAPITAL"
  | "ZERO_SIZE"
  | FillRejectionReason;

/** Smallest exposure budget (INR) an entry order is placed with. */
const MIN_ORDER_CAPITAL = 100;

// ============================================================
// Ranking Helper
// ============================================================

export function rankCandidates<T extends { symbol: string; score?: number; volume?: number; momentum?: number }>(
  candidates: T[],
  method: SignalRankingMethod = "SYMBOL_ASCENDING",
): T[] {
  return [...candidates].sort((a, b) => {
    if (method === "MOMENTUM") {
      const mA = a.momentum ?? 0;
      const mB = b.momentum ?? 0;
      if (mA !== mB) return mB - mA; // Descending
    } else if (method === "SCORECARD_SCORE") {
      const sA = a.score ?? 0;
      const sB = b.score ?? 0;
      if (sA !== sB) return sB - sA;
    } else if (method === "RELATIVE_VOLUME") {
      const vA = a.volume ?? 0;
      const vB = b.volume ?? 0;
      if (vA !== vB) return vB - vA;
    }
    // Fallback deterministic tie-breaker
    return a.symbol.localeCompare(b.symbol);
  });
}

// ============================================================
// Portfolio Engine
// ============================================================

export function runPortfolioBacktestEngine(input: PortfolioEngineInput): PortfolioBacktestResult {
  const definition = input.definition;
  const execConfig = definition.execution ?? ({ initialCapital: 100000 } as any);
  const capital = input.initialCapital ?? execConfig.initialCapital ?? 100000;
  const risk = definition.risk ?? { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 20, maximumOpenPositions: 5, allowPyramiding: false };

  const constraints: PortfolioConstraints = {
    maximumOpenPositions: input.constraints?.maximumOpenPositions ?? risk.maximumOpenPositions ?? 5,
    maximumPositionPercent: input.constraints?.maximumPositionPercent ?? risk.maximumPositionPercent ?? (100 / (risk.maximumOpenPositions || 5)),
    maximumGrossExposurePercent: input.constraints?.maximumGrossExposurePercent ?? 100,
    maximumSectorExposurePercent: input.constraints?.maximumSectorExposurePercent ?? 40,
    cashReservePercent: input.constraints?.cashReservePercent ?? 0,
  };
  const maxPos = constraints.maximumOpenPositions ?? 5;
  const maxPosPct = constraints.maximumPositionPercent ?? (100 / maxPos);
  const maxSectorPct = constraints.maximumSectorExposurePercent ?? 40;
  const maxGrossExpPct = constraints.maximumGrossExposurePercent ?? 100;
  const cashReservePct = constraints.cashReservePercent ?? 0;
  const stopPct = risk.stopLossPercent;
  const targetPct = risk.takeProfitPercent;
  const direction: "long" | "short" = definition.direction === "SHORT_ONLY" ? "short" : "long";
  const entryGroup = definition.entry ?? definition.entryRules;
  const exitGroup = definition.exit ?? definition.exitRules;

  const rankingMethod = input.rankingMethod ?? "SYMBOL_ASCENDING";
  const rebalanceSchedule = input.rebalanceSchedule ?? "SIGNAL_DRIVEN";
  const symbolSectors = input.symbolSectors ?? {};
  const priceSeries = input.priceSeries ?? "SPLIT_ADJUSTED";
  const warnings: string[] = [];

  const execModel = new ExecutionModel(execConfig);
  // NEXT_BAR_OPEN acts at bar i's open on rules evaluated at bar i-1; ON_CLOSE at bar i's close on bar i.
  const onClose = execConfig.fillPolicy === "ON_CLOSE";

  // 1. Prepare and adjust candles for each symbol
  const symbols = Object.keys(input.symbolCandles).sort();
  const adjustedCandles: Record<string, Candle[]> = {};
  const cacheMap: Record<string, IndicatorStateCache> = {};
  const timelineSet = new Set<number>();
  const candleByTsMap: Record<string, Map<number, { candle: Candle; index: number }>> = {};

  for (const sym of symbols) {
    const raw = input.symbolCandles[sym];
    if (!raw || raw.length < 5) continue;

    const corpActions = input.corporateActions?.[sym] ?? [];
    const adj = corpActions.length > 0 ? adjustCandles(raw, corpActions, priceSeries) : raw.map((c) => ({ ...c }));
    const sorted = [...adj].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    adjustedCandles[sym] = sorted;
    cacheMap[sym] = new IndicatorStateCache(sorted);

    const tsMap = new Map<number, { candle: Candle; index: number }>();
    for (let i = 0; i < sorted.length; i++) {
      const ts = new Date(sorted[i].ts).getTime();
      timelineSet.add(ts);
      tsMap.set(ts, { candle: sorted[i], index: i });
    }
    candleByTsMap[sym] = tsMap;
  }

  const timeline = Array.from(timelineSet).sort((a, b) => a - b);
  if (timeline.length === 0) {
    throw new Error("No valid candle timeline available for portfolio backtest");
  }

  // 2. State tracking
  let cash = capital;
  const positions: Map<string, PortfolioPosition> = new Map();
  const completedTrades: PortfolioTradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  const drawdownCurve: { timestamp: number; drawdown: number }[] = [];
  let peakEquity = capital;
  let excludedSignalsCount = 0;
  const excludedSignalsByReason: Partial<Record<ExcludedSignalReason, number>> = {};
  function excludeSignal(reason: ExcludedSignalReason) {
    excludedSignalsCount++;
    excludedSignalsByReason[reason] = (excludedSignalsByReason[reason] ?? 0) + 1;
  }
  let cumulativeTurnover = 0;
  let totalGrossExposureSum = 0;

  // Attribution tracking
  const pnlBySymbol: Record<string, { grossPnl: number; netPnl: number; tradeCount: number; transactionCosts: number }> = {};
  const pnlBySector: Record<string, { grossPnl: number; netPnl: number; tradeCount: number }> = {};
  const pnlByMonth: Record<string, number> = {};
  const pnlByReason: Record<string, number> = {};

  function recordTradeAttribution(trade: PortfolioTradeRecord) {
    // By symbol
    if (!pnlBySymbol[trade.symbol]) {
      pnlBySymbol[trade.symbol] = { grossPnl: 0, netPnl: 0, tradeCount: 0, transactionCosts: 0 };
    }
    pnlBySymbol[trade.symbol].grossPnl += trade.grossPnl;
    pnlBySymbol[trade.symbol].netPnl += trade.netPnl;
    pnlBySymbol[trade.symbol].tradeCount += 1;
    pnlBySymbol[trade.symbol].transactionCosts += trade.totalCosts;

    // By sector
    const sector = trade.sector || "GENERAL";
    if (!pnlBySector[sector]) {
      pnlBySector[sector] = { grossPnl: 0, netPnl: 0, tradeCount: 0 };
    }
    pnlBySector[sector].grossPnl += trade.grossPnl;
    pnlBySector[sector].netPnl += trade.netPnl;
    pnlBySector[sector].tradeCount += 1;

    // By month
    const monthKey = new Date(trade.exitTimestamp).toISOString().slice(0, 7); // YYYY-MM
    pnlByMonth[monthKey] = (pnlByMonth[monthKey] ?? 0) + trade.netPnl;

    // By reason
    const reasonKey = trade.exitReason || "unspecified";
    pnlByReason[reasonKey] = (pnlByReason[reasonKey] ?? 0) + trade.netPnl;
  }

  // Cash accounting: opening a position (long or short) sets aside its fill notional plus entry
  // charges, so `cash` is what is free to fund new positions. Each position is worth its reserved
  // notional plus unrealised P&L at the latest close.
  function calculateCurrentEquity(): { totalEquity: number; unrealizedPnl: number; grossExposure: number } {
    let unrealizedPnl = 0;
    let grossExposure = 0;
    let reservedNotional = 0;

    for (const pos of positions.values()) {
      grossExposure += pos.quantity * pos.currentPrice;
      reservedNotional += pos.quantity * pos.entryPrice;
      unrealizedPnl += pos.unrealizedPnl;
    }

    const totalEquity = cash + reservedNotional + unrealizedPnl;
    return { totalEquity, unrealizedPnl, grossExposure };
  }

  /** Values a position at `price`: the latest price known at the point of the bar being simulated. */
  function markPosition(pos: PortfolioPosition, price: number) {
    pos.currentPrice = price;
    pos.notional = pos.quantity * price;
    pos.unrealizedPnl = (pos.direction === "long" ? 1 : -1) * pos.quantity * (price - pos.entryPrice);
  }

  /**
   * Stop is checked before target (CONSERVATIVE). A bar that opens beyond a level fills at the
   * open (gap); otherwise the level itself fills.
   */
  function stopOrTargetExit(pos: PortfolioPosition, bar: Candle): { price: number; reason: string } | null {
    const isLong = pos.direction === "long";
    if (pos.stopPrice && (isLong ? bar.low <= pos.stopPrice : bar.high >= pos.stopPrice)) {
      const gapped = isLong ? bar.open <= pos.stopPrice : bar.open >= pos.stopPrice;
      return { price: gapped ? bar.open : pos.stopPrice, reason: "stop_loss" };
    }
    if (pos.targetPrice && (isLong ? bar.high >= pos.targetPrice : bar.low <= pos.targetPrice)) {
      const gapped = isLong ? bar.open >= pos.targetPrice : bar.open <= pos.targetPrice;
      return { price: gapped ? bar.open : pos.targetPrice, reason: "take_profit" };
    }
    return null;
  }

  function closePosition(
    pos: PortfolioPosition,
    bar: Candle,
    barIndex: number,
    exitPrice: number,
    exitReason: string,
    ts: number,
  ) {
    const sym = pos.symbol;
    const signalIdx = Math.max(0, barIndex - 1);
    const exitCtx: ExecutionContext = {
      bar,
      orderQuantity: pos.quantity,
      side: pos.direction === "long" ? "SELL" : "BUY",
      referencePrice: exitPrice,
      rollingAtr: cacheMap[sym].resolve("ATR", { period: 14 }, signalIdx) ?? undefined,
      referenceVolume: adjustedCandles[sym][signalIdx].volume,
      config: execConfig,
      barIndex,
    };
    // Exits always close the whole position; impact still reflects the participation.
    const exitFill = execModel.executeBarFill(exitCtx, pos.quantity, { enforceParticipationCap: false });

    const direction = pos.direction === "long" ? 1 : -1;
    const exitCharges = exitFill.costs.brokerageFees + exitFill.costs.taxesAndCharges;
    const fees = pos.entryFees + exitCharges;
    const slippage = pos.entrySlippage + exitFill.costs.slippageCost;
    const spreadCost = pos.entrySpreadCost + exitFill.costs.spreadCost;
    const marketImpactCost = pos.entryImpactCost + exitFill.costs.marketImpactCost;
    const totalCosts = fees + slippage + spreadCost + marketImpactCost;

    // Gross P&L uses reference (pre-friction) prices. Spread, slippage and impact are already in the
    // fill prices, so net P&L is the fill-to-fill P&L minus charges: each cost counted once.
    const grossPnl = direction * pos.quantity * (exitFill.referencePrice - pos.entryReferencePrice);
    const realisedPnl = direction * pos.quantity * (exitFill.effectivePrice - pos.entryPrice);
    const netPnl = realisedPnl - fees;
    const entryNotional = pos.quantity * pos.entryPrice;
    const returnPercent = entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0;

    // Release the capital reserved at entry plus realised P&L, less exit charges.
    cash += entryNotional + realisedPnl - exitCharges;
    cumulativeTurnover += exitFill.notional;

    const tradeRecord: PortfolioTradeRecord = {
      symbol: sym,
      direction: pos.direction,
      entryTimestamp: pos.entryTimestamp,
      entryPrice: pos.entryPrice,
      exitTimestamp: ts,
      exitPrice: exitFill.effectivePrice,
      quantity: pos.quantity,
      grossPnl,
      fees,
      slippage,
      spreadCost,
      marketImpactCost,
      totalCosts,
      netPnl,
      returnPercent,
      entryReason: pos.entryReason ?? "entry_rule",
      exitReason,
      sector: pos.sector,
    };

    completedTrades.push(tradeRecord);
    recordTradeAttribution(tradeRecord);
    positions.delete(sym);
  }

  // 3. Chronological simulation loop
  for (let t = 0; t < timeline.length; t++) {
    const ts = timeline[t];
    const isLastBar = t === timeline.length - 1;

    // A. Exits that happen before entries are decided, and the marks entries are sized from.
    // Under NEXT_BAR_OPEN entries are decided at bar i's open, when only its open is known: held
    // positions are marked to the open and only exits that fill at the open happen here (a rule exit
    // decided on bar i-1, or a stop/target the bar opens beyond). Stops and targets touched later in
    // the bar and the close mark come after the entries (step D), so neither the cash they free nor
    // the prices they reveal can fund or size an entry at the open. Under ON_CLOSE entries fill at
    // the close of a complete bar: positions are marked to the close and every exit happens first.
    // Symbols closed on this bar cannot reopen on it.
    const closedThisBar = new Set<string>();
    for (const [sym, pos] of positions.entries()) {
      const candleInfo = candleByTsMap[sym]?.get(ts);
      if (!candleInfo) continue; // No tick on this bar for this symbol

      const bar = candleInfo.candle;
      markPosition(pos, onClose ? bar.close : bar.open);

      // Events in bar order: a NEXT_BAR_OPEN exit rule (decided on bar i-1) fills at the open,
      // before stops and targets; an ON_CLOSE exit rule fills at the close, after them.
      const signalIdx = onClose ? candleInfo.index : candleInfo.index - 1;
      const ruleExit = signalIdx >= 0 && evaluateRuleGroup(exitGroup, cacheMap[sym], signalIdx).matched
        ? { price: onClose ? bar.close : bar.open, reason: "exit_rule" }
        : null;
      const protective = stopOrTargetExit(pos, bar);
      const exit = onClose
        ? protective || ruleExit || (isLastBar ? { price: bar.close, reason: "end_of_period" } : null)
        : ruleExit || (protective && protective.price === bar.open ? protective : null);

      if (exit && exit.price > 0) {
        closePosition(pos, bar, candleInfo.index, exit.price, exit.reason, ts);
        closedThisBar.add(sym);
      }
    }

    // B. Generate and rank new entry candidates (if not at last bar)
    if (!isLastBar) {
      const candidates: Array<{
        symbol: string;
        bar: Candle;
        barIndex: number;
        fillPrice: number;
        score: number;
        volume: number;
        momentum: number;
        atr?: number;
      }> = [];

      for (const sym of symbols) {
        if (positions.has(sym) || closedThisBar.has(sym)) continue;

        const candleInfo = candleByTsMap[sym]?.get(ts);
        if (!candleInfo || (!onClose && candleInfo.index < 1)) continue;

        const cache = cacheMap[sym];
        const signalIdx = onClose ? candleInfo.index : candleInfo.index - 1;
        const evalRes = evaluateRuleGroup(entryGroup, cache, signalIdx);

        if (evalRes.matched) {
          // Ranking, sizing and liquidity inputs come from the signal bar: under NEXT_BAR_OPEN the
          // order fills at bar i's open, before its high, low, close and volume are known (i-1);
          // under ON_CLOSE it fills at bar i's close, when bar i is complete.
          const bar = candleInfo.candle;
          const signalBar = adjustedCandles[sym][signalIdx];
          const atr = cache.resolve("ATR", { period: 14 }, signalIdx) ?? undefined;
          const momentum = signalBar.close > 0 && signalIdx >= 10
            ? (signalBar.close - adjustedCandles[sym][signalIdx - 10].close) / signalBar.close
            : 0;

          candidates.push({
            symbol: sym,
            bar,
            barIndex: candleInfo.index,
            fillPrice: onClose ? bar.close : bar.open,
            score: signalBar.volume * momentum,
            volume: signalBar.volume,
            momentum,
            atr,
          });
        }
      }

      // Rank candidate signals deterministically
      const ranked = rankCandidates(candidates, rankingMethod);

      // C. Allocate capital and execute entries in rank order. Every limit is checked against the
      // portfolio as it would stand after the order: current exposure at the step-A marks plus the
      // order's fill exposure. An order that would breach the position cap, the sector cap, the
      // gross exposure cap or the free cash is resized down to fit, and rejected if the remaining
      // budget is at most MIN_ORDER_CAPITAL or rounds to zero shares. Caps bind at entry only: later
      // price moves can drift exposure above a cap; the engine does not trim positions.
      for (const cand of ranked) {
        if (positions.size >= maxPos) {
          excludeSignal("MAX_OPEN_POSITIONS");
          continue;
        }

        const { totalEquity, grossExposure } = calculateCurrentEquity();
        if (!(totalEquity > 0)) {
          excludeSignal("NON_POSITIVE_EQUITY");
          continue;
        }

        const sector = symbolSectors[cand.symbol] ?? "GENERAL";
        let sectorExposure = 0;
        for (const p of positions.values()) {
          if (p.sector === sector) sectorExposure += p.notional;
        }

        const minimumCashToKeep = totalEquity * (cashReservePct / 100);
        const availableCashForTrade = Math.max(0, cash - minimumCashToKeep);
        // Sizing budget: the per-position cap, limited by free cash.
        const capitalForTrade = Math.min(totalEquity * (maxPosPct / 100), availableCashForTrade);
        const sectorHeadroom = totalEquity * (maxSectorPct / 100) - sectorExposure;
        const grossHeadroom = totalEquity * (maxGrossExpPct / 100) - grossExposure;
        // Most exposure this order may add without breaching any cap.
        const exposureCap = Math.min(capitalForTrade, sectorHeadroom, grossHeadroom);
        if (exposureCap <= MIN_ORDER_CAPITAL) {
          excludeSignal(
            exposureCap === sectorHeadroom ? "SECTOR_EXPOSURE_CAP"
              : exposureCap === grossHeadroom ? "GROSS_EXPOSURE_CAP"
                : "INSUFFICIENT_CAPITAL",
          );
          continue;
        }

        const sizing = calculatePositionSize(risk, {
          currentEquity: capitalForTrade,
          entryPrice: cand.fillPrice,
          atr: cand.atr,
          stopPrice: stopPct ? cand.fillPrice * (direction === "long" ? 1 - stopPct / 100 : 1 + stopPct / 100) : undefined,
        });

        const targetQty = Math.min(sizing.quantity, Math.floor(exposureCap / cand.fillPrice));
        if (!(targetQty > 0)) {
          excludeSignal("ZERO_SIZE");
          continue;
        }

        // Execute entry via ExecutionModel
        const entryCtx: ExecutionContext = {
          bar: cand.bar,
          orderQuantity: targetQty,
          side: direction === "long" ? "BUY" : "SELL",
          referencePrice: cand.fillPrice,
          rollingAtr: cand.atr,
          referenceVolume: cand.volume,
          config: execConfig,
          barIndex: cand.barIndex,
        };
        // The order's exposure is valued at the higher of its fill and reference price, so it stays
        // within the cap whether the position is valued at the fill or at the market.
        const fillExposure = (f: SingleFillResult) => f.fillQuantity * Math.max(f.effectivePrice, f.referencePrice);
        let entryFill = execModel.executeBarFill(entryCtx, targetQty);
        let cashNeeded = entryFill.notional + entryFill.costs.brokerageFees + entryFill.costs.taxesAndCharges;
        const overshoot = Math.max(fillExposure(entryFill) / exposureCap, cashNeeded / availableCashForTrade);
        if (entryFill.fillQuantity > 0 && overshoot > 1) {
          // Fill-price frictions and charges pushed the order past a cap or the free cash: shrink it.
          entryFill = execModel.executeBarFill(entryCtx, Math.floor(entryFill.fillQuantity / overshoot));
          cashNeeded = entryFill.notional + entryFill.costs.brokerageFees + entryFill.costs.taxesAndCharges;
        }

        if (entryFill.fillQuantity <= 0) {
          excludeSignal(entryFill.rejectionReason ?? "ZERO_SIZE");
          continue;
        }
        if (fillExposure(entryFill) > exposureCap || cashNeeded > availableCashForTrade) {
          excludeSignal("INSUFFICIENT_CAPITAL");
          continue;
        }

        cash -= cashNeeded;
        cumulativeTurnover += entryFill.notional;

        const fill = entryFill.effectivePrice;
        const position: PortfolioPosition = {
          symbol: cand.symbol,
          direction,
          quantity: entryFill.fillQuantity,
          entryPrice: fill,
          entryReferencePrice: entryFill.referencePrice,
          entryTimestamp: ts,
          currentPrice: fill,
          notional: entryFill.notional,
          unrealizedPnl: 0,
          sector,
          entryReason: "entry_rule",
          stopPrice: stopPct ? fill * (direction === "long" ? 1 - stopPct / 100 : 1 + stopPct / 100) : undefined,
          targetPrice: targetPct ? fill * (direction === "long" ? 1 + targetPct / 100 : 1 - targetPct / 100) : undefined,
          entryFees: entryFill.costs.brokerageFees + entryFill.costs.taxesAndCharges,
          entrySlippage: entryFill.costs.slippageCost,
          entrySpreadCost: entryFill.costs.spreadCost,
          entryImpactCost: entryFill.costs.marketImpactCost,
        };
        positions.set(cand.symbol, position);
        // Value the new position like the held ones: at the price the entry was decided on.
        markPosition(position, cand.fillPrice);
      }
    }

    // D. Rest of the bar under NEXT_BAR_OPEN, after the entries decided at the open: stops and
    // targets touched intrabar (on held and just-opened positions alike), the end-of-period
    // close-out, then the close mark. Under ON_CLOSE step A already did all of this.
    if (!onClose) {
      for (const [sym, pos] of positions.entries()) {
        const candleInfo = candleByTsMap[sym]?.get(ts);
        if (!candleInfo) continue;
        const bar = candleInfo.candle;
        const exit = stopOrTargetExit(pos, bar) || (isLastBar ? { price: bar.close, reason: "end_of_period" } : null);
        if (exit && exit.price > 0) {
          closePosition(pos, bar, candleInfo.index, exit.price, exit.reason, ts);
        } else {
          markPosition(pos, bar.close);
        }
      }
    }

    // E. Mark-to-market continuous equity recording
    const { totalEquity, grossExposure } = calculateCurrentEquity();
    peakEquity = Math.max(peakEquity, totalEquity);
    const dd = peakEquity > 0 ? (peakEquity - totalEquity) / peakEquity : 0;

    equityCurve.push({ timestamp: ts, equity: totalEquity });
    drawdownCurve.push({ timestamp: ts, drawdown: dd });

    if (totalEquity > 0) {
      totalGrossExposureSum += (grossExposure / totalEquity) * 100;
    }
  }

  // 4. Compute Benchmark Curve if benchmark candles supplied
  let benchmarkCurve: EquityPoint[] | undefined;
  if (input.benchmarkCandles?.length) {
    const sortedBench = [...input.benchmarkCandles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const firstTs = timeline[0];
    const lastTs = timeline[timeline.length - 1];
    const benchStart = sortedBench.find((c) => new Date(c.ts).getTime() >= firstTs);
    if (benchStart) {
      benchmarkCurve = sortedBench
        .filter((c) => new Date(c.ts).getTime() >= firstTs && new Date(c.ts).getTime() <= lastTs)
        .map((c) => ({ timestamp: new Date(c.ts).getTime(), equity: capital * (c.close / benchStart.close) }));
    }
  }

  // 5. Compute institutional performance metrics
  const timeframe = (adjustedCandles[symbols[0]]?.[0]?.tf as string) ?? "1d";
  const metrics = computeMetrics(equityCurve, completedTrades as any, benchmarkCurve, timeframe);

  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? capital;
  const grossPnl = completedTrades.reduce((s, t) => s + t.grossPnl, 0);
  const netPnl = completedTrades.reduce((s, t) => s + t.netPnl, 0);
  const totalTransactionCosts = completedTrades.reduce((s, t) => s + t.totalCosts, 0);
  const costDragPercent = grossPnl > 0 ? (totalTransactionCosts / grossPnl) * 100 : 0;
  const avgExposure = timeline.length > 0 ? totalGrossExposureSum / timeline.length : 0;

  // Reproducibility hash: SHA-256 over the canonical JSON (keys sorted at every depth) of the
  // resolved configuration and every input series, candles ordered by timestamp. Any change to a
  // candle, an action, the definition or a constraint changes it; input ordering does not.
  const byTs = (a: Candle, b: Candle) => new Date(a.ts).getTime() - new Date(b.ts).getTime();
  const reproducibilityHash = createHash("sha256").update(canonicalJson({
    definition,
    initialCapital: capital,
    constraints,
    rankingMethod,
    rebalanceSchedule,
    priceSeries,
    symbolSectors,
    corporateActions: input.corporateActions ?? {},
    symbolCandles: Object.fromEntries(symbols.map((s) => [s, [...input.symbolCandles[s]].sort(byTs)])),
    benchmarkCandles: [...(input.benchmarkCandles ?? [])].sort(byTs),
  })).digest("hex");

  return {
    initialCapital: capital,
    finalEquity,
    totalReturn: metrics.totalReturn,
    cagr: metrics.annualisedReturn,
    sharpe: metrics.sharpe,
    sortino: metrics.sortino,
    maxDrawdown: metrics.maxDrawdown,
    calmar: metrics.calmar,
    winRate: metrics.winRate,
    profitFactor: metrics.profitFactor,
    tradeCount: completedTrades.length,
    grossPnl,
    netPnl,
    totalTransactionCosts,
    costDragPercent,
    turnover: cumulativeTurnover,
    exposure: avgExposure,
    equityCurve,
    drawdownCurve,
    benchmarkCurve,
    trades: completedTrades,
    attribution: {
      pnlBySymbol,
      pnlBySector,
      pnlByMonth,
      pnlByReason,
    },
    excludedSignalsCount,
    excludedSignalsByReason,
    warnings,
    reproducibilityHash,
  };
}
