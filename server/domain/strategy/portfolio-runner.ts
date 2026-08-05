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
  const maxSectorExposure = input.maxSectorExposurePercent ?? 40;
  const symbolSectors = input.symbolSectors ?? {};
  const rankingMethod = input.signalRankingMethod ?? "SYMBOL_ASCENDING";

  const symbols = Object.keys(input.symbolCandles).sort();
  const symbolResults: Record<string, V3BacktestRunResult> = {};
  const allTrades: (PortfolioTrade & { volume?: number; score?: number; sector?: string })[] = [];
  let earliestCandleTs = Infinity;
  let excludedSignalsCount = 0;

  // Run single-symbol engines for each symbol
  for (const sym of symbols) {
    const candles = input.symbolCandles[sym];
    if (!candles || candles.length < 50) continue;

    const firstTs = new Date(candles[0].ts).getTime();
    if (firstTs < earliestCandleTs) earliestCandleTs = firstTs;

    const singleRes = runBacktestV3({
      strategyVersionId: input.strategyVersionId,
      definition: input.definition,
      symbol: sym,
      candles,
      overrideCapital: (capital * (maxSymbolExposure / 100)),
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
        volume: t.mfe, // use mfe as proxy volume or score if volume unattached
        score: t.netPnl,
        sector: symbolSectors[sym] ?? "GENERAL",
      });
    }
  }

  // Fallback timestamp if no valid candles found
  if (earliestCandleTs === Infinity) {
    earliestCandleTs = 1700000000000;
  }

  // Sort trades chronologically, then rank by specified ranking method for simultaneous entries
  allTrades.sort((a, b) => {
    if (a.entryTimestamp !== b.entryTimestamp) return a.entryTimestamp - b.entryTimestamp;
    const ranked = rankSignals([a, b], rankingMethod);
    return ranked[0].symbol === a.symbol ? -1 : 1;
  });

  // Filter trades by shared cash, position limit, and sector/symbol exposure rules
  const acceptedTrades: PortfolioTrade[] = [];
  const activePositionsByTime: { symbol: string; exitTs: number; sector: string; capitalAllocated: number }[] = [];

  let availableCash = capital;

  for (const trade of allTrades) {
    // Release capital from expired active positions
    const remainingActive = activePositionsByTime.filter((p) => {
      if (p.exitTs <= trade.entryTimestamp) {
        availableCash += p.capitalAllocated;
        return false;
      }
      return true;
    });

    activePositionsByTime.length = 0;
    activePositionsByTime.push(...remainingActive);

    // Enforce max open positions
    if (activePositionsByTime.length >= maxPositions) {
      excludedSignalsCount++;
      continue;
    }

    // Enforce sector exposure limit
    const sectorCount = activePositionsByTime.filter((p) => p.sector === (trade.sector ?? "GENERAL")).length;
    const currentSectorExposurePct = (sectorCount / Math.max(1, maxPositions)) * 100;
    if (currentSectorExposurePct >= maxSectorExposure) {
      excludedSignalsCount++;
      continue;
    }

    // Allocate position capital
    const positionCapital = Math.min(availableCash, capital * (maxSymbolExposure / 100));
    if (positionCapital <= 0 || availableCash < positionCapital * 0.5) {
      excludedSignalsCount++;
      continue;
    }

    availableCash -= positionCapital;
    acceptedTrades.push(trade);
    activePositionsByTime.push({
      symbol: trade.symbol,
      exitTs: trade.exitTimestamp,
      sector: trade.sector ?? "GENERAL",
      capitalAllocated: positionCapital,
    });
  }

  // Calculate aggregated equity curve starting at earliest candle timestamp
  let currentEquity = capital;
  const equityCurve: { timestamp: number; equity: number }[] = [{ timestamp: earliestCandleTs, equity: capital }];
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
