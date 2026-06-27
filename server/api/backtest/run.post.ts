import { createError, defineEventHandler, readBody, setResponseHeader } from "h3";
import { z } from "zod";
import type { Candle } from "@shared/types";
import { getCandles } from "../../data/sources/yahoo";
import { runBacktest } from "../../domain/backtest/engine";
import { RsiStrategy, SmaCrossStrategy } from "../../domain/backtest/strategies";
import { resolveMarketSymbol } from "../../domain/market/symbol";

const InputSchema = z.object({
  symbol: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9&.-]+$/).default("RELIANCE"),
  timeframe: z.enum(["5m", "15m", "1h", "1d", "1wk"]).default("1d"),
  range: z.enum(["5d", "1mo", "3mo", "1y", "2y", "5y"]).default("2y"),
  strategy: z.enum(["sma_cross", "rsi"]).default("sma_cross"),
  initialCapital: z.number().positive().max(100_000_000).default(1_000_000),
  feeBps: z.number().min(0).max(100).default(5),
  params: z.record(z.number()).default({}),
});

const RANGE_MS: Record<z.infer<typeof InputSchema>["range"], number> = {
  "5d": 5 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "3mo": 90 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  "2y": 2 * 365 * 24 * 60 * 60 * 1000,
  "5y": 5 * 365 * 24 * 60 * 60 * 1000,
};

const PERIODS_PER_YEAR: Record<Candle["tf"], number> = {
  "1m": 94_500,
  "5m": 18_900,
  "15m": 6_300,
  "1h": 1_512,
  "1d": 252,
  "1wk": 52,
};

export default defineEventHandler(async (event) => {
  const parsed = InputSchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? "Invalid backtest input" });
  }
  const input = parsed.data;
  const resolved = resolveMarketSymbol(input.symbol.toUpperCase());
  const to = new Date();
  const from = new Date(to.getTime() - RANGE_MS[input.range]);
  const candles = (await getCandles(resolved.ticker, from, to, input.timeframe)).map((candle) => ({
    ...candle,
    symbol: resolved.symbol,
  }));
  if (candles.length < 2) {
    throw createError({ statusCode: 422, statusMessage: "Not enough market history for this backtest" });
  }

  const strategy = input.strategy === "sma_cross"
    ? SmaCrossStrategy({
        fast: Math.max(2, Math.floor(input.params.fast ?? 20)),
        slow: Math.max(3, Math.floor(input.params.slow ?? 50)),
      })
    : RsiStrategy({
        period: Math.max(2, Math.floor(input.params.period ?? 14)),
        oversold: input.params.oversold ?? 30,
        overbought: input.params.overbought ?? 70,
      });

  if (strategy.name === "sma_cross" && strategy.params.fast >= strategy.params.slow) {
    throw createError({ statusCode: 400, statusMessage: "Fast SMA must be shorter than slow SMA" });
  }

  const result = runBacktest(candles, strategy, {
    initialCapital: input.initialCapital,
    feeBps: input.feeBps,
    periodsPerYear: PERIODS_PER_YEAR[input.timeframe],
  });

  setResponseHeader(event, "cache-control", "no-store");
  return {
    asOf: new Date().toISOString(),
    source: "yahoo",
    delayed: true,
    symbol: resolved.symbol,
    timeframe: input.timeframe,
    range: input.range,
    candleCount: candles.length,
    strategy: { name: strategy.name, params: strategy.params },
    ...result,
  };
});
