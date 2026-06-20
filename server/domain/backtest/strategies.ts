import type { Candle } from "@shared/types";

export type Signal = { ts: string; side: "BUY" | "SELL"; price: number };

export type Strategy = {
  name: "sma_cross" | "rsi";
  params: Record<string, number>;
  signals: (candles: Candle[]) => Signal[];
};

function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : undefined);
  }
  return out;
}

export function SmaCrossStrategy(params: { fast: number; slow: number }): Strategy {
  return {
    name: "sma_cross",
    params,
    signals: (candles: Candle[]): Signal[] => {
      const closes = candles.map((c) => c.close);
      const fastSma = sma(closes, params.fast);
      const slowSma = sma(closes, params.slow);
      const out: Signal[] = [];
      for (let i = 1; i < candles.length; i++) {
        const f1 = fastSma[i - 1],
          f2 = fastSma[i],
          s1 = slowSma[i - 1],
          s2 = slowSma[i];
        if (f1 !== undefined && f2 !== undefined && s1 !== undefined && s2 !== undefined) {
          if (f1 <= s1 && f2 > s2) out.push({ ts: candles[i].ts, side: "BUY", price: candles[i].close });
          if (f1 >= s1 && f2 < s2) out.push({ ts: candles[i].ts, side: "SELL", price: candles[i].close });
        }
      }
      return out;
    },
  };
}

function rsiValues(closes: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (i <= period) {
      if (diff > 0) gain += diff;
      else loss += -diff;
      if (i === period) {
        const rs = loss === 0 ? 100 : gain / loss;
        out.push(100 - 100 / (1 + rs));
      } else {
        out.push(undefined);
      }
    } else {
      const prevGain = gain / period;
      const prevLoss = loss / period;
      const curGain = diff > 0 ? diff : 0;
      const curLoss = diff < 0 ? -diff : 0;
      gain = prevGain * (period - 1) + curGain;
      loss = prevLoss * (period - 1) + curLoss;
      const rs = loss === 0 ? 100 : gain / loss;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function RsiStrategy(params: { period: number; oversold: number; overbought: number }): Strategy {
  return {
    name: "rsi",
    params,
    signals: (candles: Candle[]): Signal[] => {
      const closes = candles.map((c) => c.close);
      const r = rsiValues(closes, params.period);
      const out: Signal[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prev = r[i - 1],
          cur = r[i];
        if (prev === undefined || cur === undefined) continue;
        if (prev < params.oversold && cur >= params.oversold)
          out.push({ ts: candles[i].ts, side: "BUY", price: candles[i].close });
        if (prev > params.overbought && cur <= params.overbought)
          out.push({ ts: candles[i].ts, side: "SELL", price: candles[i].close });
      }
      return out;
    },
  };
}