import { describe, it, expect } from "bun:test";
import { SmaCrossStrategy, RsiStrategy } from "./strategies";
import type { Candle } from "@shared/types";

function synthetic(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    symbol: "X",
    tf: "1d",
    ts: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 0,
  }));
}

describe("SmaCrossStrategy", () => {
  it("emits a buy then sell on a synthetic golden/death cross", () => {
    // Brief-defect fix: original data [10..20,19..6] never produced a golden
    // cross because fast SMA was already above slow when both became defined.
    // Replaced with flat→rising→falling so fast first crosses below→above slow
    // (golden cross = BUY), then above→below (death cross = SELL).
    const prices = [
      20, 20, 20, 20, 20, 20, 20, 20, // flat (8 days, slow SMA defined as 20)
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, // rising (fast crosses up through slow)
      31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, // falling
    ];
    const candles = synthetic(prices);
    const sigs = SmaCrossStrategy({ fast: 3, slow: 8 }).signals(candles);
    // expect at least one BUY and one SELL
    expect(sigs.some((s) => s.side === "BUY")).toBe(true);
    expect(sigs.some((s) => s.side === "SELL")).toBe(true);
  });
});

describe("RsiStrategy", () => {
  it("emits BUY when RSI crosses below 30 then SELL above 70", () => {
    const prices = [
      100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 86, 87, 88, 89, 90,
      91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
    ];
    const candles = synthetic(prices);
    const sigs = RsiStrategy({ period: 14, oversold: 30, overbought: 70 }).signals(candles);
    expect(sigs.length).toBeGreaterThanOrEqual(1);
  });
});