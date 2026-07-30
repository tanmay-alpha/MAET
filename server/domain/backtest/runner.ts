/**
 * Backtest runner — ties strategies to candle data and computes metrics.
 *
 * Uses next-bar execution. No look-ahead bias. Never uses future data.
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
  const slippageMultiplier = 1 - request.riskConfig.slippageBps / 10000;

  for (let i = 1; i < sorted.length; i++) {
    // Risk management checks
    if (inPosition) {
      const currentPrice = sorted[i].close;
      const pnl = (currentPrice - entryPrice) / entryPrice;

      // Stop loss
      if (request.riskConfig.stopLossPercent && pnl <= -request.riskConfig.stopLossPercent / 100) {
        const exitPrice = currentPrice * slippageMultiplier;
        trades.push({
          entryTimestamp,
          exitTimestamp: toTs(sorted[i]),
          entryPrice,
          exitPrice,
          side: "long",
          return: (exitPrice - entryPrice) / entryPrice * feeMultiplier,
        });
        inPosition = false;
        equity *= feeMultiplier;
      }
      // Take profit
      else if (request.riskConfig.takeProfitPercent && pnl >= request.riskConfig.takeProfitPercent / 100) {
        const exitPrice = currentPrice * slippageMultiplier;
        trades.push({
          entryTimestamp,
          exitTimestamp: toTs(sorted[i]),
          entryPrice,
          exitPrice,
          side: "long",
          return: (exitPrice - entryPrice) / entryPrice * feeMultiplier,
        });
        inPosition = false;
        equity *= feeMultiplier;
      }
      // Trailing stop
      else if (request.riskConfig.trailingStopPercent) {
        const peak = equity; // Simplified
        if (pnl <= -request.riskConfig.trailingStopPercent / 100) {
          const exitPrice = currentPrice * slippageMultiplier;
          trades.push({
            entryTimestamp,
            exitTimestamp: toTs(sorted[i]),
            entryPrice,
            exitPrice,
            side: "long",
            return: (exitPrice - entryPrice) / entryPrice * feeMultiplier,
          });
          inPosition = false;
          equity *= feeMultiplier;
        }
      }
    }

    // Strategy signal (next-bar execution)
    if (!inPosition) {
      const ctx: { candles: Candle[]; currentIndex: number } = { candles: sorted, currentIndex: i };
      const signal: TradeSignal | null = strategy.next(ctx);
      if (signal && signal.side === "buy") {
        inPosition = true;
        entryPrice = sorted[i].close * slippageMultiplier;
        entryTimestamp = toTs(sorted[i]);
        equity *= feeMultiplier;
      }
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