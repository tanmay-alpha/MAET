import { describe, it, expect } from "bun:test";
import { computeVWAP } from "./canonical";

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Epoch ms for an Asia/Kolkata wall-clock time. */
function istMs(y: number, m: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS;
}

function bar(ts: string | number | Date, base: number, volume: number) {
  return { ts, open: base, high: base + 2, low: base - 1, close: base + 1, volume };
}

const typical = (c: { high: number; low: number; close: number }) => (c.high + c.low + c.close) / 3;

describe("computeVWAP session anchoring (Asia/Kolkata)", () => {
  it("resets at the first bar of each IST trading day", () => {
    const session1 = [0, 5, 10, 15].map((m, i) =>
      bar(new Date(istMs(2025, 1, 6, 9, 15 + m)).toISOString(), 100 + i * 3, 1000 + i * 100)
    );
    const session2 = [0, 5, 10].map((m, i) =>
      bar(new Date(istMs(2025, 1, 7, 9, 15 + m)).toISOString(), 150 + i * 2, 800 + i * 50)
    );
    const candles = [...session1, ...session2];

    const vwap = computeVWAP(candles);

    expect(vwap[session1.length]).toBeCloseTo(typical(session2[0]), 10);

    const s2pv = session2.slice(0, 2).reduce((acc, c) => acc + typical(c) * c.volume, 0);
    const s2v = session2.slice(0, 2).reduce((acc, c) => acc + c.volume, 0);
    expect(vwap[session1.length + 1]).toBeCloseTo(s2pv / s2v, 10);
  });

  it("uses the IST calendar day, not the UTC day, as the session boundary", () => {
    // 05:20 and 05:40 IST on the same IST day fall on different UTC dates.
    const a = bar(istMs(2025, 3, 3, 5, 20), 200, 500);
    const b = bar(istMs(2025, 3, 3, 5, 40), 210, 700);
    // 23:50 IST and 00:10 IST next day share a UTC date but are different IST days.
    const c = bar(new Date(istMs(2025, 3, 3, 23, 50)), 220, 400);
    const d = bar(new Date(istMs(2025, 3, 4, 0, 10)), 230, 600);

    const vwap = computeVWAP([a, b, c, d]);

    const abExpected = (typical(a) * a.volume + typical(b) * b.volume) / (a.volume + b.volume);
    expect(vwap[1]).toBeCloseTo(abExpected, 10);
    expect(vwap[3]).toBeCloseTo(typical(d), 10);
  });

  it("accumulates across the whole series when candles carry no timestamp", () => {
    const candles = [
      { high: 12, low: 9, close: 11, volume: 100 },
      { high: 15, low: 11, close: 14, volume: 300 },
    ];
    const vwap = computeVWAP(candles);
    const expected = (typical(candles[0]) * 100 + typical(candles[1]) * 300) / 400;
    expect(vwap[1]).toBeCloseTo(expected, 10);
  });
});
