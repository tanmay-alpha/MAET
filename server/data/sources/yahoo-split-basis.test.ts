import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fixture from "./fixtures/yahoo-chart-reliance-2024-bonus.json";
import * as redisClient from "../redis/client";
import { _resetCircuitForTest, getCandles, normalizeYahooCorporateActions, type YahooChartEvents } from "./yahoo";
import { adjustCandles, type CorporateAction } from "../../domain/data/corporate-actions";
import { istDateKey } from "../../domain/market/clock";

// Real Yahoo v8 chart response for RELIANCE.NS, 21 Oct - 31 Oct 2024, interval=1d,
// events=div,splits (fetched 19 Nov 2026, meta trimmed). Reliance's 1:1 bonus went ex on
// 28 Oct 2024; Yahoo reports it as a 2:1 split. A 1:1 bonus halves the traded price, so
// on the exchange's raw prices the last pre-bonus close is about twice the first ex-date close.
//
// getCandles returns `indicators.quote` exactly as the daily processor stores it in `candles`.
// The check below shows those bars are already split-adjusted by Yahoo, which is why
// runner-v3 must not apply stored SPLIT rows to them (docs/RESEARCH_ENGINE.md §7).

const origFetch = globalThis.fetch;
beforeEach(() => {
  spyOn(redisClient, "getCachedJson").mockImplementation(async () => undefined);
  spyOn(redisClient, "setCachedJson").mockImplementation(async () => {});
  globalThis.fetch = (async () => Response.json(fixture)) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  _resetCircuitForTest();
});

async function storedBars() {
  const candles = await getCandles("RELIANCE", new Date("2024-10-21T00:00:00Z"), new Date("2024-11-01T00:00:00Z"), "1d");
  const [split] = normalizeYahooCorporateActions(fixture.chart.result[0]!.events as YahooChartEvents, fixture.chart.result[0]!.meta);
  const exIndex = candles.findIndex((candle) => istDateKey(new Date(candle.ts)) >= split!.exDate);
  return { candles, split: split!, before: candles[exIndex - 1]!, exDay: candles[exIndex]! };
}

describe("split basis of stored Yahoo candles across RELIANCE's 1:1 bonus (ex 2024-10-28)", () => {
  it("finds the bonus as a 2:1 split and the sessions either side of it", async () => {
    const { split, before, exDay } = await storedBars();
    expect(split).toEqual({ kind: "split", exDate: "2024-10-28", numerator: 2, denominator: 1 });
    expect(istDateKey(new Date(before.ts))).toBe("2024-10-25");
    expect(istDateKey(new Date(exDay.ts))).toBe("2024-10-28");
  });

  it("shows no halving across the ex-date: pre-bonus bars are already on the post-bonus share basis", async () => {
    const { before, exDay } = await storedBars();
    expect(before.close).toBeCloseTo(1327.85, 2);
    expect(exDay.close).toBeCloseTo(1334.35, 2);
    // Raw exchange prices would show exDay/before close near 0.5.
    expect(exDay.close / before.close).toBeGreaterThan(0.9);
    expect(exDay.close / before.close).toBeLessThan(1.1);
    // Yahoo scales volume by the same factor: pre-bonus sessions trade in post-bonus share counts.
    expect(before.volume).toBeGreaterThan(exDay.volume);
  });

  it("would double-adjust if runner-v3 applied the stored split: a fake +100% gap at the ex-date", async () => {
    const { candles, exDay } = await storedBars();
    const split: CorporateAction = { symbol: "RELIANCE", actionType: "SPLIT", exDate: "2024-10-28", ratioNumerator: 2, ratioDenominator: 1 };
    const adjusted = adjustCandles(candles, [split], "SPLIT_ADJUSTED");
    const exIndex = adjusted.findIndex((candle) => candle.ts === exDay.ts);
    expect(adjusted[exIndex]!.close / adjusted[exIndex - 1]!.close).toBeGreaterThan(1.9);
  });
});
