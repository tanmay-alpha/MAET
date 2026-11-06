import { describe, it, expect } from "bun:test";
import { CandleWriter, RETAINED_CLOSED_MINUTES } from "./candle-writer";
import type { Tick } from "@shared/types";

/** `volume` is the provider's cumulative traded volume for the day. */
function tick(price: number, tsIso: string, volume = 1): Tick {
  return { exchange: "NSE", symbol: "RELIANCE", price, volume, ts: tsIso, source: "angelone", quality: "live" };
}

describe("CandleWriter", () => {
  it("aggregates three ticks within one minute into one bucket", () => {
    const cw = new CandleWriter();
    const minute = "2026-06-19T03:45";
    cw.onTick(tick(100, `${minute}:00.000Z`));
    cw.onTick(tick(105, `${minute}:20.000Z`));
    cw.onTick(tick(110, `${minute}:40.000Z`));
    const out = cw.flush("RELIANCE");
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
    const out = cw.flush("RELIANCE");
    expect(out).toHaveLength(2);
  });

  it("uses deltas of cumulative day volume, with the first observation as baseline", () => {
    const cw = new CandleWriter();
    cw.onTick(tick(100, "2026-06-19T03:45:00.000Z", 10_000));
    cw.onTick(tick(101, "2026-06-19T03:45:20.000Z", 10_040));
    cw.onTick(tick(102, "2026-06-19T03:45:40.000Z", 10_100));
    cw.onTick(tick(103, "2026-06-19T03:46:05.000Z", 10_175));
    const out = cw.flush("RELIANCE");
    expect(out.map((candle) => candle.volume)).toEqual([100, 75]);
  });

  it("restarts the volume baseline at the IST day boundary", () => {
    const cw = new CandleWriter();
    cw.onTick(tick(100, "2026-06-19T09:59:00.000Z", 5_000_000));
    cw.onTick(tick(100, "2026-06-19T09:59:30.000Z", 5_000_500));
    // Next trading day 09:15 IST: the provider's counter restarted near zero.
    cw.onTick(tick(105, "2026-06-22T03:45:10.000Z", 1_200));
    cw.onTick(tick(106, "2026-06-22T03:45:50.000Z", 1_500));
    const out = cw.flush("RELIANCE");
    expect(out.at(-1)).toMatchObject({ ts: "2026-06-22T03:45:00.000Z", volume: 1_500, open: 105, close: 106 });
  });

  it("ignores out-of-order ticks instead of rewriting prices or volume", () => {
    const cw = new CandleWriter();
    cw.onTick(tick(100, "2026-06-19T03:45:10.000Z", 1_000));
    cw.onTick(tick(110, "2026-06-19T03:45:30.000Z", 1_050));
    cw.onTick(tick(90, "2026-06-19T03:45:20.000Z", 1_020));
    cw.onTick(tick(111, "2026-06-19T03:45:40.000Z", 1_060));
    const [candle] = cw.flush("RELIANCE");
    expect(candle).toMatchObject({ low: 100, close: 111, volume: 60 });
  });

  it("keeps a bounded number of closed minutes per symbol", () => {
    const cw = new CandleWriter();
    const start = Date.parse("2026-06-19T03:45:00.000Z");
    for (let minute = 0; minute < 300; minute++) {
      cw.onTick(tick(100 + minute, new Date(start + minute * 60_000).toISOString(), 1_000 + minute));
    }
    const out = cw.flush("RELIANCE");
    expect(out).toHaveLength(RETAINED_CLOSED_MINUTES + 1);
    expect(out.at(-1)?.ts).toBe(new Date(start + 299 * 60_000).toISOString());
  });
});
