import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { presetToV3Definition, type RiskConfig } from "./preset-to-v3-adapter";
import { runBacktestV3 } from "../strategy/runner-v3";

const risk: RiskConfig = { initialCapital: 100_000, feeBps: 0, slippageBps: 0, positionSizePercent: 100, maximumOpenPositions: 1 };

const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
  const p = 100 + 10 * Math.sin(i / 9) + 4 * Math.sin(i / 3);
  return { symbol: "MACD", tf: "1d", ts: new Date(Date.UTC(2023, 0, 2) + i * 86_400_000).toISOString(), open: p, high: p + 1, low: p - 1, close: p, volume: 100_000, source: "test" };
});

const entryTimes = (definition: StrategyDefinition) =>
  runBacktestV3({ strategyVersionId: "preset", definition, symbol: "MACD", candles, timeframe: "1d" }).trades.map((t) => t.entryTimestamp);

describe("presetToV3Definition — MACD_CROSS", () => {
  it("trades on the requested MACD periods, not the 12/26/9 defaults", () => {
    const custom = entryTimes(presetToV3Definition({ type: "MACD_CROSS", fastPeriod: 5, slowPeriod: 13, signalPeriod: 4 }, risk));
    const defaults = entryTimes(presetToV3Definition({ type: "MACD_CROSS" }, risk));
    const explicitDefaults = entryTimes(presetToV3Definition({ type: "MACD_CROSS", fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, risk));

    expect(custom.length).toBeGreaterThan(0);
    expect(custom).not.toEqual(defaults);
    expect(explicitDefaults).toEqual(defaults);
  });
});
