import { describe, it, expect } from "bun:test";
import { normalizeAndFillGaps, adjustForCorporateAction } from "./candle";

const day = (d: string) => new Date(d + "T00:00:00.000Z");

describe("candle normalization", () => {
  it("fills missing daily bars within the window", () => {
    const raw = [
      { symbol: "X", tf: "1d" as const, ts: "2026-01-01T00:00:00.000Z", open: 100, high: 110, low: 95, close: 105, volume: 1 },
      // gap 2026-01-02 missing
      { symbol: "X", tf: "1d" as const, ts: "2026-01-03T00:00:00.000Z", open: 105, high: 108, low: 104, close: 107, volume: 1 },
    ];
    const out = normalizeAndFillGaps(raw, day("2026-01-01"), day("2026-01-03"), "1d", []);
    expect(out).toHaveLength(3);
    expect(out[1].close).toBe(105); // forward-filled
  });

  it("applies a 2:1 split to historical candles before the split date", () => {
    const candle = { symbol: "X", tf: "1d" as const, ts: "2025-01-01T00:00:00.000Z", open: 200, high: 210, low: 195, close: 205, volume: 1000 };
    const split = { symbol: "X", exDate: "2025-06-01", action: "SPLIT" as const, ratio: 2 };
    const adj = adjustForCorporateAction(candle, split);
    expect(adj.open).toBe(100);
    expect(adj.high).toBe(105);
    expect(adj.low).toBe(97.5);
    expect(adj.close).toBe(102.5);
    expect(adj.volume).toBe(2000);
  });
});
