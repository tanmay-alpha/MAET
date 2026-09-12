import { createError, defineEventHandler, readBody, setResponseHeader } from "h3";
import { z } from "zod";
import type { Candle } from "@shared/types";
import { getCandles } from "../../data/sources/yahoo";
// P0-A fix: migrate REST endpoint to V3 engine (engine.ts is deprecated).
import { runBacktestV3, InsufficientHistoryV3Error } from "../../domain/strategy/runner-v3";
import { presetToV3Definition } from "../../domain/backtest/preset-to-v3-adapter";
import type { StrategyParams, RiskConfig } from "../../domain/backtest/strategies-v2";
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
  let fetchedCandles: Candle[];
  try {
    fetchedCandles = (await getCandles(resolved.ticker, from, to, input.timeframe)).map((candle) => ({
      ...candle,
      symbol: resolved.symbol,
    }));
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Market history temporarily unavailable" });
  }
  if (fetchedCandles.length < 2) {
    throw createError({ statusCode: 422, statusMessage: "Not enough market history for this backtest" });
  }

  // Translate legacy strategy selection to V3 preset params
  const strategyParams: StrategyParams = input.strategy === "sma_cross"
    ? {
        type: "SMA_CROSS",
        fastPeriod: Math.max(2, Math.floor(input.params.fast ?? 20)),
        slowPeriod: Math.max(3, Math.floor(input.params.slow ?? 50)),
      }
    : {
        type: "RSI_REVERSAL",
        rsiPeriod: Math.max(2, Math.floor(input.params.period ?? 14)),
        rsiOversold: input.params.oversold ?? 30,
        rsiOverbought: input.params.overbought ?? 70,
      };

  if (strategyParams.type === "SMA_CROSS" && (strategyParams.fastPeriod ?? 20) >= (strategyParams.slowPeriod ?? 50)) {
    throw createError({ statusCode: 400, statusMessage: "Fast SMA must be shorter than slow SMA" });
  }

  const riskConfig: RiskConfig = {
    initialCapital: input.initialCapital,
    feeBps: input.feeBps,
    slippageBps: 5,
    positionSizePercent: 100,
    maximumOpenPositions: 1,
  };

  try {
    const definition = presetToV3Definition(strategyParams, riskConfig);
    const result = runBacktestV3({
      strategyVersionId: `rest:${strategyParams.type}:${Date.now()}`,
      definition,
      symbol: resolved.symbol,
      candles: fetchedCandles,
    });

    setResponseHeader(event, "cache-control", "no-store");
    // Explicitly structure the return to avoid duplicate key errors from the spread.
    // result already contains symbol, engineVersion etc. so we omit them from the wrapper.
    return {
      asOf: new Date().toISOString(),
      source: "yahoo",
      delayed: true,
      timeframe: input.timeframe,
      range: input.range,
      candleCount: fetchedCandles.length,
      strategy: { name: strategyParams.type, params: strategyParams },
      ...result,
      // Ensure API consumers always see these metadata fields regardless of what V3 result returns.
      symbol: resolved.symbol,
      engineVersion: "v3" as const,
    };
  } catch (err) {
    if (err instanceof InsufficientHistoryV3Error) {
      throw createError({ statusCode: 422, statusMessage: err.message });
    }
    throw createError({ statusCode: 500, statusMessage: "Backtest execution failed" });
  }
});

