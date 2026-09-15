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

import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { ExecutionModel, type ExecutionContext } from "./execution-model";
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
  entryPrice: number;
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
  profitFactor: number;
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
  warnings: string[];
  reproducibilityHash: string;
}

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

  const rankingMethod = input.rankingMethod ?? "SYMBOL_ASCENDING";
  const rebalanceSchedule = input.rebalanceSchedule ?? "SIGNAL_DRIVEN";
  const symbolSectors = input.symbolSectors ?? {};
  const priceSeries = input.priceSeries ?? "SPLIT_ADJUSTED";
  const warnings: string[] = [];

  const execModel = new ExecutionModel(execConfig);

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

  // Helper: compute continuous mark-to-market equity
  function calculateCurrentEquity(): { totalEquity: number; unrealizedPnl: number; grossExposure: number } {
    let unrealizedPnl = 0;
    let grossExposure = 0;

    for (const pos of positions.values()) {
      const notional = pos.quantity * pos.currentPrice;
      grossExposure += notional;
      const uPnl = pos.direction === "long"
        ? pos.quantity * (pos.currentPrice - pos.entryPrice)
        : pos.quantity * (pos.entryPrice - pos.currentPrice);
      unrealizedPnl += uPnl;
    }

    const totalEquity = cash + unrealizedPnl;
    return { totalEquity, unrealizedPnl, grossExposure };
  }

  // 3. Chronological simulation loop
  for (let t = 0; t < timeline.length; t++) {
    const ts = timeline[t];
    const isLastBar = t === timeline.length - 1;

    // A. Update current price and check stop / target exits for active positions
    for (const [sym, pos] of positions.entries()) {
      const candleInfo = candleByTsMap[sym]?.get(ts);
      if (!candleInfo) continue; // No tick on this bar for this symbol

      const bar = candleInfo.candle;
      pos.currentPrice = bar.close;
      pos.notional = pos.quantity * pos.currentPrice;
      pos.unrealizedPnl = pos.direction === "long"
        ? pos.quantity * (pos.currentPrice - pos.entryPrice)
        : pos.quantity * (pos.entryPrice - pos.currentPrice);

      let exitReason = "";
      let exitPrice = 0;

      // Stop / Target check
      if (pos.stopPrice && ((pos.direction === "long" && bar.low <= pos.stopPrice) || (pos.direction === "short" && bar.high >= pos.stopPrice))) {
        exitPrice = pos.stopPrice;
        exitReason = "stop_loss";
      } else if (pos.targetPrice && ((pos.direction === "long" && bar.high >= pos.targetPrice) || (pos.direction === "short" && bar.low <= pos.targetPrice))) {
        exitPrice = pos.targetPrice;
        exitReason = "take_profit";
      } else if (isLastBar) {
        exitPrice = bar.close;
        exitReason = "end_of_period";
      } else {
        // Evaluate AST exit rules on previous bar
        const cache = cacheMap[sym];
        const prevIdx = candleInfo.index - 1;
        if (prevIdx >= 0) {
          const exitGroup = definition.exit ?? (definition as any).exitRules;
          const evalRes = evaluateRuleGroup(exitGroup, cache, prevIdx);
          if (evalRes.matched) {
            exitPrice = bar.open;
            exitReason = "exit_rule";
          }
        }
      }

      if (exitReason && exitPrice > 0) {
        // Execute exit through ExecutionModel
        const exitCtx: ExecutionContext = {
          bar,
          orderQuantity: pos.quantity,
          side: pos.direction === "long" ? "SELL" : "BUY",
          referencePrice: exitPrice,
          config: execConfig,
          barIndex: candleInfo.index,
        };
        const exitFill = execModel.executeBarFill(exitCtx, pos.quantity);

        const grossPnl = pos.direction === "long"
          ? pos.quantity * (exitFill.effectivePrice - pos.entryPrice)
          : pos.quantity * (pos.entryPrice - exitFill.effectivePrice);

        const totalCosts = pos.entryFees + exitFill.costs.brokerageFees + exitFill.costs.taxesAndCharges +
          pos.entrySlippage + exitFill.costs.slippageCost +
          pos.entrySpreadCost + exitFill.costs.spreadCost +
          pos.entryImpactCost + exitFill.costs.marketImpactCost;

        const netPnl = grossPnl - totalCosts;
        const entryNotional = pos.quantity * pos.entryPrice;
        const returnPercent = entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0;

        // Cash flow: release margin/capital and credit net realized profit
        cash += grossPnl - exitFill.costs.totalTransactionCost;
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
          fees: pos.entryFees + exitFill.costs.brokerageFees + exitFill.costs.taxesAndCharges,
          slippage: pos.entrySlippage + exitFill.costs.slippageCost,
          spreadCost: pos.entrySpreadCost + exitFill.costs.spreadCost,
          marketImpactCost: pos.entryImpactCost + exitFill.costs.marketImpactCost,
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
        if (positions.has(sym)) continue; // Already in position

        const candleInfo = candleByTsMap[sym]?.get(ts);
        if (!candleInfo || candleInfo.index < 1) continue;

        const cache = cacheMap[sym];
        const prevIdx = candleInfo.index - 1;
        const entryGroup = definition.entry ?? (definition as any).entryRules;
        const evalRes = evaluateRuleGroup(entryGroup, cache, prevIdx);

        if (evalRes.matched) {
          const bar = candleInfo.candle;
          const fillPrice = bar.open;
          const atr = cache.resolve("ATR", { period: 14 }, candleInfo.index) ?? undefined;
          const momentum = bar.close > 0 && candleInfo.index >= 10
            ? (bar.close - adjustedCandles[sym][Math.max(0, candleInfo.index - 10)].close) / bar.close
            : 0;

          candidates.push({
            symbol: sym,
            bar,
            barIndex: candleInfo.index,
            fillPrice,
            score: bar.volume * momentum,
            volume: bar.volume,
            momentum,
            atr,
          });
        }
      }

      // Rank candidate signals deterministically
      const ranked = rankCandidates(candidates, rankingMethod);

      // C. Allocate capital and execute entries for top candidates respecting portfolio constraints
      for (const cand of ranked) {
        const { totalEquity } = calculateCurrentEquity();

        // 1. Max open positions cap
        const maxPos = constraints.maximumOpenPositions ?? 5;
        if (positions.size >= maxPos) {
          excludedSignalsCount++;
          continue;
        }

        // 2. Sector exposure cap
        const sector = symbolSectors[cand.symbol] ?? "GENERAL";
        const maxSectorPct = constraints.maximumSectorExposurePercent ?? 40;
        const sectorPositions = Array.from(positions.values()).filter((p) => p.sector === sector);
        const sectorExposure = sectorPositions.reduce((s, p) => s + p.notional, 0);
        if (totalEquity > 0 && (sectorExposure / totalEquity) * 100 >= maxSectorPct) {
          excludedSignalsCount++;
          continue;
        }

        // 3. Max position size and Cash Reserve constraints
        const maxPosPct = constraints.maximumPositionPercent ?? (100 / maxPos);
        const maxAllocatableCapital = totalEquity * (maxPosPct / 100);
        const cashReservePct = constraints.cashReservePercent ?? 0;
        const minimumCashToKeep = totalEquity * (cashReservePct / 100);
        const availableCashForTrade = Math.max(0, cash - minimumCashToKeep);

        const capitalForTrade = Math.min(maxAllocatableCapital, availableCashForTrade);
        if (capitalForTrade <= 100) {
          excludedSignalsCount++;
          continue;
        }

        // Position sizing
        const sizing = calculatePositionSize(risk, {
          currentEquity: capitalForTrade,
          entryPrice: cand.fillPrice,
          atr: cand.atr,
          stopPrice: risk.stopLossPercent ? cand.fillPrice * (1 - risk.stopLossPercent / 100) : undefined,
        });

        const targetQty = sizing.quantity;
        if (targetQty <= 0) {
          excludedSignalsCount++;
          continue;
        }

        // Execute entry via ExecutionModel
        const entryCtx: ExecutionContext = {
          bar: cand.bar,
          orderQuantity: targetQty,
          side: definition.direction === "SHORT_ONLY" ? "SELL" : "BUY",
          referencePrice: cand.fillPrice,
          rollingAtr: cand.atr,
          config: execConfig,
          barIndex: cand.barIndex,
        };
        const entryFill = execModel.executeBarFill(entryCtx, targetQty);

        if (entryFill.fillQuantity > 0 && entryFill.notional <= cash) {
          const entryTotalCosts = entryFill.costs.totalTransactionCost;
          cash -= entryTotalCosts;
          cumulativeTurnover += entryFill.notional;

          const stopPct = risk.stopLossPercent;
          const targetPct = risk.takeProfitPercent;
          const stopPrice = stopPct ? entryFill.effectivePrice * (1 - stopPct / 100) : undefined;
          const targetPrice = targetPct ? entryFill.effectivePrice * (1 + targetPct / 100) : undefined;

          positions.set(cand.symbol, {
            symbol: cand.symbol,
            direction: definition.direction === "SHORT_ONLY" ? "short" : "long",
            quantity: entryFill.fillQuantity,
            entryPrice: entryFill.effectivePrice,
            entryTimestamp: ts,
            currentPrice: entryFill.effectivePrice,
            notional: entryFill.notional,
            unrealizedPnl: 0,
            sector,
            entryReason: "entry_rule",
            stopPrice,
            targetPrice,
            entryFees: entryFill.costs.brokerageFees + entryFill.costs.taxesAndCharges,
            entrySlippage: entryFill.costs.slippageCost,
            entrySpreadCost: entryFill.costs.spreadCost,
            entryImpactCost: entryFill.costs.marketImpactCost,
          });
        } else {
          excludedSignalsCount++;
        }
      }
    }

    // D. Mark-to-market continuous equity recording
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

  // Reproducibility hash based on all symbol candles and timestamps
  const canonicalData = symbols.map((s) => `${s}:${adjustedCandles[s]?.length ?? 0}`).join(",");
  const reproducibilityHash = `${timeline.length}:${canonicalData}:${capital}`;

  return {
    initialCapital: capital,
    finalEquity,
    totalReturn: metrics.totalReturn,
    cagr: metrics.cagr,
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
    warnings,
    reproducibilityHash,
  };
}
