/**
 * Backtest Lab V2 — extended strategy set with risk-aware configuration.
 *
 * Strategies implemented:
 *  - SMA_CROSS
 *  - EMA_CROSS
 *  - RSI_REVERSAL
 *  - MACD_CROSS
 *  - DONCHIAN_BREAKOUT
 *  - BOLLINGER_MEAN_REVERSION
 *  - COMBINED_RULES
 *
 * All strategies use next-bar execution. No future data. No look-ahead bias.
 */

import type { Candle } from "@shared/types";

export type StrategyType =
  | "SMA_CROSS"
  | "EMA_CROSS"
  | "RSI_REVERSAL"
  | "MACD_CROSS"
  | "DONCHIAN_BREAKOUT"
  | "BOLLINGER_MEAN_REVERSION"
  | "COMBINED_RULES";

export interface RiskConfig {
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  positionSizePercent: number;
  maximumOpenPositions: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  trailingStopPercent?: number;
}

export interface StrategyParams {
  type: StrategyType;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  donchianPeriod?: number;
  bollingerPeriod?: number;
  bollingerStdDev?: number;
  combinedRules?: Array<{ indicator: string; op: string; value: number }>;
}

export interface TradeSignal {
  timestamp: number;
  side: "buy" | "sell";
  reason: string;
}

export interface StrategyContext {
  candles: Candle[];
  currentIndex: number;
}

export interface Strategy {
  type: StrategyType;
  init: (candles: Candle[]) => void;
  next: (ctx: StrategyContext) => TradeSignal | null;
}

// ============= SMA Calculation =============

export function sma(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(0);
  if (period <= 0) return result;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

// ============= EMA Calculation =============

export function ema(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(0);
  if (period <= 0 || values.length === 0) return result;
  const k = 2 / (period + 1);
  let prev = values[0];
  result[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

// ============= RSI Calculation =============

export function rsi(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(50);
  if (values.length < period + 1 || period <= 0) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ============= MACD Calculation =============

export function macd(values: number[], fast: number, slow: number, signal: number): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

// ============= Bollinger Bands =============

export function bollinger(values: number[], period: number, stdDev: number): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = sma(values, period);
  const upper: number[] = new Array(values.length).fill(0);
  const lower: number[] = new Array(values.length).fill(0);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += (values[j] - middle[i]) ** 2;
    }
    const sd = Math.sqrt(sum / period);
    upper[i] = middle[i] + sd * stdDev;
    lower[i] = middle[i] - sd * stdDev;
  }
  return { upper, middle, lower };
}

// ============= Donchian Channel =============

export function donchian(highs: number[], lows: number[], period: number): { upper: number[]; lower: number[] } {
  const upper: number[] = new Array(highs.length).fill(0);
  const lower: number[] = new Array(lows.length).fill(0);
  for (let i = period - 1; i < highs.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, highs[j]);
      lo = Math.min(lo, lows[j]);
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

// ============= Strategy Factory =============

export function createStrategy(params: StrategyParams, _risk: RiskConfig): Strategy {
  switch (params.type) {
    case "SMA_CROSS":
      return createSmaCross(params);
    case "EMA_CROSS":
      return createEmaCross(params);
    case "RSI_REVERSAL":
      return createRsiReversal(params);
    case "MACD_CROSS":
      return createMacdCross(params);
    case "DONCHIAN_BREAKOUT":
      return createDonchianBreakout(params);
    case "BOLLINGER_MEAN_REVERSION":
      return createBollingerReversion(params);
    case "COMBINED_RULES":
      return createCombinedRules(params);
    default:
      throw new Error(`Unknown strategy type: ${String((params as { type: string }).type)}`);
  }
}

function createSmaCross(params: StrategyParams): Strategy {
  const fast = params.fastPeriod ?? 10;
  const slow = params.slowPeriod ?? 20;
  let fastMa: number[] = [];
  let slowMa: number[] = [];
  return {
    type: "SMA_CROSS",
    init: (candles) => {
      const closes = candles.map((c) => c.close);
      fastMa = sma(closes, fast);
      slowMa = sma(closes, slow);
    },
    next: (ctx) => {
      const i = ctx.currentIndex;
      if (i < 1) return null;
      if (fastMa[i] === 0 || slowMa[i] === 0) return null;
      if (fastMa[i - 1] <= slowMa[i - 1] && fastMa[i] > slowMa[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: `SMA(${fast}) crossed above SMA(${slow})` };
      }
      if (fastMa[i - 1] >= slowMa[i - 1] && fastMa[i] < slowMa[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "sell", reason: `SMA(${fast}) crossed below SMA(${slow})` };
      }
      return null;
    },
  };
}

function createEmaCross(params: StrategyParams): Strategy {
  const fast = params.fastPeriod ?? 9;
  const slow = params.slowPeriod ?? 21;
  let fastMa: number[] = [];
  let slowMa: number[] = [];
  return {
    type: "EMA_CROSS",
    init: (candles) => {
      const closes = candles.map((c) => c.close);
      fastMa = ema(closes, fast);
      slowMa = ema(closes, slow);
    },
    next: (ctx) => {
      const i = ctx.currentIndex;
      if (i < 1) return null;
      if (fastMa[i] === 0 || slowMa[i] === 0) return null;
      if (fastMa[i - 1] <= slowMa[i - 1] && fastMa[i] > slowMa[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: `EMA(${fast}) crossed above EMA(${slow})` };
      }
      if (fastMa[i - 1] >= slowMa[i - 1] && fastMa[i] < slowMa[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "sell", reason: `EMA(${fast}) crossed below EMA(${slow})` };
      }
      return null;
    },
  };
}

function createRsiReversal(params: StrategyParams): Strategy {
  const period = params.rsiPeriod ?? 14;
  const oversold = params.rsiOversold ?? 30;
  const overbought = params.rsiOverbought ?? 70;
  let rsiValues: number[] = [];
  return {
    type: "RSI_REVERSAL",
    init: (candles) => {
      rsiValues = rsi(candles.map((c) => c.close), period);
    },
    next: (ctx) => {
      const i = ctx.currentIndex;
      if (i < 1) return null;
      if (rsiValues[i - 1] <= oversold && rsiValues[i] > oversold) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: `RSI(${period}) recovered above ${oversold}` };
      }
      if (rsiValues[i - 1] >= overbought && rsiValues[i] < overbought) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "sell", reason: `RSI(${period}) fell below ${overbought}` };
      }
      return null;
    },
  };
}

function createMacdCross(params: StrategyParams): Strategy {
  const fast = params.fastPeriod ?? 12;
  const slow = params.slowPeriod ?? 26;
  const signal = params.signalPeriod ?? 9;
  let macdLine: number[] = [];
  let signalLine: number[] = [];
  return {
    type: "MACD_CROSS",
    init: (candles) => {
      const m = macd(candles.map((c) => c.close), fast, slow, signal);
      macdLine = m.macd;
      signalLine = m.signal;
    },
    next: (ctx) => {
      const i = ctx.currentIndex;
      if (i < 1) return null;
      if (macdLine[i - 1] <= signalLine[i - 1] && macdLine[i] > signalLine[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: `MACD crossed above signal` };
      }
      if (macdLine[i - 1] >= signalLine[i - 1] && macdLine[i] < signalLine[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "sell", reason: `MACD crossed below signal` };
      }
      return null;
    },
  };
}

function createDonchianBreakout(params: StrategyParams): Strategy {
  const period = params.donchianPeriod ?? 20;
  let upper: number[] = [];
  let lower: number[] = [];
  return {
    type: "DONCHIAN_BREAKOUT",
    init: (candles) => {
      const d = donchian(candles.map((c) => c.high), candles.map((c) => c.low), period);
      upper = d.upper;
      lower = d.lower;
    },
    next: (ctx) => {
      const i = ctx.currentIndex;
      if (i === 0) return null;
      const close = ctx.candles[i].close;
      const prevClose = ctx.candles[i - 1].close;
      if (upper[i] === 0) return null;
      if (prevClose <= upper[i - 1] && close > upper[i - 1]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: `Donchian(${period}) breakout above` };
      }
      if (prevClose >= lower[i - 1] && close < lower[i - 1]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "sell", reason: `Donchian(${period}) breakdown below` };
      }
      return null;
    },
  };
}

function createBollingerReversion(params: StrategyParams): Strategy {
  const period = params.bollingerPeriod ?? 20;
  const stdDev = params.bollingerStdDev ?? 2;
  let bands: { upper: number[]; middle: number[]; lower: number[] } | null = null;
  return {
    type: "BOLLINGER_MEAN_REVERSION",
    init: (candles) => {
      bands = bollinger(candles.map((c) => c.close), period, stdDev);
    },
    next: (ctx) => {
      if (!bands) return null;
      const i = ctx.currentIndex;
      if (i === 0) return null;
      const close = ctx.candles[i].close;
      if (bands.lower[i] === 0) return null;
      if (close < bands.lower[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: `Price below lower Bollinger band` };
      }
      if (close > bands.upper[i]) {
        return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "sell", reason: `Price above upper Bollinger band` };
      }
      return null;
    },
  };
}

function createCombinedRules(params: StrategyParams): Strategy {
  const rules = params.combinedRules ?? [];
  let prepared: Array<{ check: (i: number) => boolean }> = [];
  return {
    type: "COMBINED_RULES",
    init: (candles) => {
      const closes = candles.map((c) => c.close);
      prepared = rules.map((r) => {
        const vals = r.indicator.startsWith("rsi") ? rsi(closes, 14) : sma(closes, 20);
        return {
          check: (i: number) => {
            const v = vals[i];
            if (r.op === "above") return v > r.value;
            if (r.op === "below") return v < r.value;
            return false;
          },
        };
      });
    },
    next: (ctx) => {
      const i = ctx.currentIndex;
      const allTrue = prepared.every((p) => p.check(i));
      if (allTrue) return { timestamp: new Date(ctx.candles[i].ts).getTime(), side: "buy", reason: "All combined rules satisfied" };
      return null;
    },
  };
}