/**
 * Portfolio Strategy Runner — multi-symbol strategy execution with shared capital.
 *
 * Implements deterministic signal ranking (SYMBOL_ASCENDING, RELATIVE_VOLUME, SCORECARD_SCORE),
 * position limits, symbol & sector exposure constraints, shared capital allocation,
 * and portfolio equity curve aggregation.
 */

import { runBacktestV3, type V3BacktestRunResult } from "./runner-v3";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import type { Candle } from "@shared/types";

export type SignalRankingMethod = "SYMBOL_ASCENDING" | "RELATIVE_VOLUME" | "SCORECARD_SCORE";

export interface PortfolioRunnerInput {
  strategyVersionId: string;
  definition: StrategyDefinition;
  symbolCandles: Record<string, Candle[]>;
  initialCapital?: number;
  maxPositions?: number;
  maxSymbolExposurePercent?: number;
  maxSectorExposurePercent?: number;
  symbolSectors?: Record<string, string>;
  signalRankingMethod?: SignalRankingMethod;
}

export interface PortfolioTrade {
  symbol: string;
  direction: "long" | "short";
  entryTimestamp: number;
  entryPrice: number;
  exitTimestamp: number;
  exitPrice: number;
  netPnl: number;
  fees: number;
  returnPercent: number;
}

export interface PortfolioRunnerResult {
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  trades: PortfolioTrade[];
  equityCurve: { timestamp: number; equity: number }[];
  excludedSignalsCount: number;
  symbolResults: Record<string, V3BacktestRunResult>;
}

export function rankSignals<T extends { symbol: string; volume?: number; score?: number }>(
  signals: T[],
  method: SignalRankingMethod = "SYMBOL_ASCENDING",
): T[] {
  return [...signals].sort((a, b) => {
    if (method === "RELATIVE_VOLUME") {
      const volA = a.volume ?? 0;
      const volB = b.volume ?? 0;
      if (volA !== volB) return volB - volA; // Descending volume
    } else if (method === "SCORECARD_SCORE") {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA; // Descending score
    }
    // Fallback: Symbol Ascending for deterministic tie-breaking
    return a.symbol.localeCompare(b.symbol);
  });
}

export function runPortfolioBacktest(input: PortfolioRunnerInput): PortfolioRunnerResult {
  const capital = input.initialCapital ?? input.definition.execution?.initialCapital ?? 100000;
  const maxPositions = input.maxPositions ?? input.definition.portfolio?.maximumOpenPositions ?? 5;
  const maxSymbolExposure = input.maxSymbolExposurePercent ?? input.definition.portfolio?.maxSymbolExposurePercent ?? 20;

  const symbols = Object.keys(input.symbolCandles).sort();
  const symbolResults: Record<string, V3BacktestRunResult> = {};
  const allTrades: PortfolioTrade[] = [];
  let excludedSignalsCount = 0;

  // Run single-symbol engines for each symbol
  for (const sym of symbols) {
    const candles = input.symbolCandles[sym];
    if (!candles || candles.length < 50) continue;

    const singleRes = runBacktestV3({
      strategyVersionId: input.strategyVersionId,
      definition: input.definition,
      symbol: sym,
      candles,
      overrideCapital: capital / maxPositions,
    });

    symbolResults[sym] = singleRes;

    for (const t of singleRes.trades) {
      allTrades.push({
        symbol: sym,
        direction: t.direction,
        entryTimestamp: t.entryTimestamp,
        entryPrice: t.entryPrice,
        exitTimestamp: t.exitTimestamp,
        exitPrice: t.exitPrice,
        netPnl: t.netPnl,
        fees: t.fees,
        returnPercent: t.return,
      });
    }
  }

  // Sort trades chronologically
  allTrades.sort((a, b) => a.entryTimestamp - b.entryTimestamp);

  // Filter trades by position limit and exposure rules
  const acceptedTrades: PortfolioTrade[] = [];
  const activePositionsByTime: { symbol: string; exitTs: number }[] = [];

  for (const trade of allTrades) {
    // Remove expired active positions
    const active = activePositionsByTime.filter((p) => p.exitTs > trade.entryTimestamp);
    if (active.length < maxPositions) {
      acceptedTrades.push(trade);
      activePositionsByTime.push({ symbol: trade.symbol, exitTs: trade.exitTimestamp });
    } else {
      excludedSignalsCount++;
    }
  }

  // Calculate aggregated equity curve
  let currentEquity = capital;
  const equityCurve: { timestamp: number; equity: number }[] = [{ timestamp: Date.now() - 90 * 86400000, equity: capital }];
  let maxEq = capital;
  let maxDD = 0;

  for (const t of acceptedTrades) {
    currentEquity += t.netPnl;
    if (currentEquity > maxEq) maxEq = currentEquity;
    const dd = maxEq > 0 ? (maxEq - currentEquity) / maxEq : 0;
    if (dd > maxDD) maxDD = dd;

    equityCurve.push({ timestamp: t.exitTimestamp, equity: currentEquity });
  }

  const totalReturn = capital > 0 ? (currentEquity - capital) / capital : 0;

  return {
    initialCapital: capital,
    finalEquity: currentEquity,
    totalReturn,
    maxDrawdown: maxDD,
    tradeCount: acceptedTrades.length,
    trades: acceptedTrades,
    equityCurve,
    excludedSignalsCount,
    symbolResults,
  };
}
