import { describe, it, expect } from "bun:test";
import { CandleWriter } from "./candle-writer";
import type { Tick } from "@shared/types";

function tick(p: number, tsIso: string): Tick {
  return { exchange: "NSE", symbol: "RELIANCE", price: p, volume: 1, ts: tsIso, source: "yahoo" };
}

describe("CandleWriter", () => {
  it("aggregates three ticks within one minute into one bucket", () => {
    const cw = new CandleWriter();
    const minute = "2026-06-19T03:45";
    cw.onTick(tick(100, `${minute}:00.000Z`));
    cw.onTick(tick(105, `${minute}:20.000Z`));
    cw.onTick(tick(110, `${minute}:40.000Z`));
    const out = cw.flush("RELIANCE", "1m");
    expect(out).toHaveLength(1);
    expect(out[0].open).toBe(100);
    expect(out[0].close).toBe(110);
    expect(out[0].high).toBe(110);
    expect(out[0].low).toBe(100);
  });

  it("creates a new bucket when the minute rolls over", () => {
    const cw = new CandleWriter();
    cw.onTick(tick(100, "2026-06-19T03:45:00.000Z"));
    cw.onTick(tick(200, "2026-06-19T03:46:00.000Z"));
    const out = cw.flush("RELIANCE", "1m");
    expect(out).toHaveLength(2);
  });
});
