/**
 * @deprecated LEGACY V2 backtest runner. Superseded by runner-v3.ts (runBacktestV3).
 * The Backtest Lab UI now routes through preset-to-v3-adapter.ts → runner-v3.ts.
 * This file is retained for the backtest-v2 integration test only.
 * DO NOT use in new code.
 *
 * P0 bugs fixed in this file (2026-09-13):
 *   - BUY slippage now correctly worsens the fill (higher price for buyer)
 *   - SELL signals from strategy are now processed (position can exit via strategy signal)
 *   - Trailing stop now tracks actual price high-water-mark (was a constant before)
 * Remaining reason to use V3 instead: MTM equity, short position support, reproducibility hash.
 */

import type { Candle } from "@shared/types";
import { createStrategy, type StrategyType, type StrategyParams, type RiskConfig, type TradeSignal } from "./strategies-v2";
import { computeMetrics, type EquityPoint, type TradeRecord, type BacktestMetrics } from "./risk-metrics";

export interface BacktestRunRequest {
  symbol: string;
  from: string;
  to: string;
  strategyType: StrategyType;
  strategyParams: StrategyParams;
  riskConfig: RiskConfig;
  benchmarkSymbol?: string;
}

export interface BacktestRunResult {
  runId: string;
  symbol: string;
  from: string;
  to: string;
  strategy: StrategyType;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  benchmarkCurve?: EquityPoint[];
  trades: TradeRecord[];
  signalCount: number;
  insufficientHistory: boolean;
}

export class InsufficientHistoryError extends Error {
  constructor(minRequired: number, actual: number) {
    super(`Insufficient history: required ${minRequired}, got ${actual}`);
    this.name = "InsufficientHistoryError";
  }
}

const toTs = (c: Candle): number => new Date(c.ts).getTime();

export function runBacktest(request: BacktestRunRequest, candles: Candle[], benchmarkCandles?: Candle[]): BacktestRunResult {
  const sorted = [...candles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const runId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Minimum candles: slowPeriod + 5 buffer
  const slowPeriod = (request.strategyParams as { slowPeriod?: number }).slowPeriod ?? 26;
  const minCandles = slowPeriod + 20;

  if (sorted.length < minCandles) {
    throw new InsufficientHistoryError(minCandles, sorted.length);
  }

  const strategy = createStrategy(request.strategyParams, request.riskConfig);
  strategy.init(sorted);

  const trades: TradeRecord[] = [];
  let inPosition = false;
  let entryPrice = 0;
  let entryTimestamp = 0;
  let equity = request.riskConfig.initialCapital;
  const equityCurve: EquityPoint[] = [{ timestamp: toTs(sorted[0]), equity }];

  const feeMultiplier = 1 - request.riskConfig.feeBps / 10000;
  // P0-B fix: BUY slippage must worsen the fill (higher price for buyer).
  // Previously used (1 - bps) which gave the buyer an impossibly good price.
  const buySlippageMultiplier = 1 + (request.riskConfig.slippageBps ?? 0) / 10000;
  // SELL slippage worsens for the seller (lower price received).
  const sellSlippageMultiplier = 1 - (request.riskConfig.slippageBps ?? 0) / 10000;

  // P0-B fix: trailing stop peak tracker — must follow actual price high-water-mark.
  // Previously was set to equity once at entry and never updated (completely broken).
  let trailingPeak = 0;

  for (let i = 1; i < sorted.length; i++) {
    // Risk management checks
    if (inPosition) {
      const currentPrice = sorted[i].close;
      const pnl = (currentPrice - entryPrice) / entryPrice;

      // P0-B fix: update trailing peak on every bar when in position.
      if (request.riskConfig.trailingStopPercent) {
        if (currentPrice > trailingPeak) trailingPeak = currentPrice;
      }

      // Stop loss
      if (request.riskConfig.stopLossPercent && pnl <= -request.riskConfig.stopLossPercent / 100) {
        const exitPrice = currentPrice * sellSlippageMultiplier;
        const tradeReturn = (exitPrice - entryPrice) / entryPrice;
        equity *= (1 + tradeReturn * (1 - request.riskConfig.feeBps / 10000));
        trades.push({
          entryTimestamp,
          exitTimestamp: toTs(sorted[i]),
          entryPrice,
          exitPrice,
          side: "long",
          return: tradeReturn * feeMultiplier,
        });
        inPosition = false;
        trailingPeak = 0;
      }
      // Take profit
      else if (request.riskConfig.takeProfitPercent && pnl >= request.riskConfig.takeProfitPercent / 100) {
        const exitPrice = currentPrice * sellSlippageMultiplier;
        const tradeReturn = (exitPrice - entryPrice) / entryPrice;
        equity *= (1 + tradeReturn * (1 - request.riskConfig.feeBps / 10000));
        trades.push({
          entryTimestamp,
          exitTimestamp: toTs(sorted[i]),
          entryPrice,
          exitPrice,
          side: "long",
          return: tradeReturn * feeMultiplier,
        });
        inPosition = false;
        trailingPeak = 0;
      }
      // Trailing stop — P0-B fix: compare against running high-water-mark, not a constant peak.
      else if (request.riskConfig.trailingStopPercent && trailingPeak > 0) {
        const trailingDrawdown = (trailingPeak - currentPrice) / trailingPeak;
        if (trailingDrawdown >= request.riskConfig.trailingStopPercent / 100) {
          const exitPrice = currentPrice * sellSlippageMultiplier;
          const tradeReturn = (exitPrice - entryPrice) / entryPrice;
          equity *= (1 + tradeReturn * (1 - request.riskConfig.feeBps / 10000));
          trades.push({
            entryTimestamp,
            exitTimestamp: toTs(sorted[i]),
            entryPrice,
            exitPrice,
            side: "long",
            return: tradeReturn * feeMultiplier,
          });
          inPosition = false;
          trailingPeak = 0;
        }
      }
    }

    // Strategy signal (next-bar execution)
    const ctx: { candles: Candle[]; currentIndex: number } = { candles: sorted, currentIndex: i };
    const signal: TradeSignal | null = strategy.next(ctx);

    // P0-B fix: handle SELL exit signals — previously only BUY was handled so positions
    // could NEVER exit via strategy signal; they could only exit via SL/TP/trailing.
    if (inPosition && signal && signal.side === "sell") {
      const exitPrice = sorted[i].close * sellSlippageMultiplier;
      const tradeReturn = (exitPrice - entryPrice) / entryPrice;
      equity *= (1 + tradeReturn * (1 - request.riskConfig.feeBps / 10000));
      trades.push({
        entryTimestamp,
        exitTimestamp: toTs(sorted[i]),
        entryPrice,
        exitPrice,
        side: "long",
        return: tradeReturn * feeMultiplier,
      });
      inPosition = false;
      trailingPeak = 0;
    }

    if (!inPosition && signal && signal.side === "buy") {
      inPosition = true;
      // P0-B fix: BUY entry pays HIGHER price (slippage worsens buyer fill).
      entryPrice = sorted[i].close * buySlippageMultiplier;
      entryTimestamp = toTs(sorted[i]);
      equity *= feeMultiplier;
      trailingPeak = sorted[i].close;
    }

    equityCurve.push({ timestamp: toTs(sorted[i]), equity });
  }

  // Close any open position at end
  if (inPosition) {
    const last = sorted[sorted.length - 1];
    trades.push({
      entryTimestamp,
      exitTimestamp: toTs(last),
      entryPrice,
      exitPrice: last.close,
      side: "long",
      return: (last.close - entryPrice) / entryPrice,
    });
  }

  const benchmarkCurve: EquityPoint[] | undefined = benchmarkCandles
    ? buildBenchmarkCurve(sorted, benchmarkCandles, request.riskConfig.initialCapital)
    : undefined;

  const metrics = computeMetrics(equityCurve, trades, benchmarkCurve);

  return {
    runId,
    symbol: request.symbol,
    from: request.from,
    to: request.to,
    strategy: request.strategyType,
    metrics,
    equityCurve,
    benchmarkCurve,
    trades,
    signalCount: trades.length,
    insufficientHistory: false,
  };
}

function buildBenchmarkCurve(
  candles: Candle[],
  benchmarkCandles: Candle[],
  initialCapital: number,
): EquityPoint[] {
  const sortedBenchmark = [...benchmarkCandles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const firstTs = toTs(candles[0]);
  const benchmarkStart = sortedBenchmark.find((c) => toTs(c) >= firstTs);
  if (!benchmarkStart) return [];
  const startPrice = benchmarkStart.close;
  const lastTs = toTs(candles[candles.length - 1]);
  return sortedBenchmark
    .filter((c) => toTs(c) >= firstTs && toTs(c) <= lastTs)
    .map((c) => ({ timestamp: toTs(c), equity: initialCapital * (c.close / startPrice) }));
}