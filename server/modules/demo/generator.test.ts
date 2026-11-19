import { describe, expect, it } from "bun:test";
import { bundledNseHolidays, tradingDaysFrom } from "./calendar";
import { DEMO_REGIMES, generateDemoSeries, type DemoSeriesSpec } from "./generator";
import { DEMO_COMPANIES, DEMO_SEED } from "./universe";

const holidays = bundledNseHolidays();
const spec: DemoSeriesSpec = { symbol: "DEMO-TEST", startPrice: 250, volatilityScale: 1.2, baseVolume: 900_000 };
const days = tradingDaysFrom("2026-01-01", 10_000, holidays);
const series = generateDemoSeries(spec, DEMO_SEED, days);

describe("synthetic demo generator", () => {
  it("returns identical bars for the same seed and different bars for another seed", () => {
    const again = generateDemoSeries(spec, DEMO_SEED, days);
    expect(again).toEqual(series);

    const otherSeed = generateDemoSeries(spec, DEMO_SEED + 1, days.slice(0, 50));
    expect(otherSeed.candles.map((bar) => bar.close)).not.toEqual(series.candles.slice(0, 50).map((bar) => bar.close));
  });

  it("gives every symbol its own stream from one seed", () => {
    const [first, second] = DEMO_COMPANIES;
    const a = generateDemoSeries({ ...first, startPrice: 100 }, DEMO_SEED, days.slice(0, 50));
    const b = generateDemoSeries({ ...second, symbol: second.symbol, startPrice: 100, volatilityScale: first.volatilityScale }, DEMO_SEED, days.slice(0, 50));
    expect(a.candles.map((bar) => bar.close)).not.toEqual(b.candles.map((bar) => bar.close));
  });

  it("keeps OHLC, tick, volume and timestamp invariants on 10,000 bars", () => {
    const { candles } = series;
    expect(candles).toHaveLength(10_000);
    let previousTs = "";
    for (const bar of candles) {
      expect(bar.low).toBeGreaterThan(0);
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      for (const price of [bar.open, bar.high, bar.low, bar.close]) {
        expect(Number.isFinite(price)).toBe(true);
        // A whole number of 0.05 ticks, stored with at most two decimals.
        expect(Math.round(price * 100) % 5).toBe(0);
        expect(Math.abs(price * 100 - Math.round(price * 100))).toBeLessThan(1e-6);
      }
      expect(Number.isInteger(bar.volume)).toBe(true);
      expect(bar.volume).toBeGreaterThan(0);
      expect(bar.ts > previousTs).toBe(true);
      previousTs = bar.ts;
      expect(bar.tf).toBe("1d");
    }
  });

  it("switches between regimes whose volatility differs", () => {
    const { candles, regimes } = series;
    const switches = regimes.filter((regime, i) => i > 0 && regime !== regimes[i - 1]).length;
    // Regimes persist ~50 sessions, so 10,000 bars see on the order of 200 switches.
    expect(switches).toBeGreaterThan(100);
    expect(new Set(regimes)).toEqual(new Set(Object.keys(DEMO_REGIMES)));

    const annualisedVolatility = (regime: string) => {
      const returns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        if (regimes[i] === regime) returns.push(Math.log(candles[i].close / candles[i - 1].close));
      }
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
      return Math.sqrt(variance * 252);
    };
    const calm = annualisedVolatility("calm");
    const bear = annualisedVolatility("bear");
    // Configured: calm 12%, bear 34%, both scaled by the spec's 1.2.
    expect(calm).toBeGreaterThan(0.12 * 1.2 * 0.8);
    expect(calm).toBeLessThan(0.12 * 1.2 * 1.25);
    expect(bear).toBeGreaterThan(calm * 2);
  });
});
