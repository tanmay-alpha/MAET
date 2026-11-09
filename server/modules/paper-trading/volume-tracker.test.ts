import { describe, expect, it } from "bun:test";
import { CumulativeVolumeTracker } from "./volume-tracker";
import { tickLiquidityCap } from "./tick-processor";

const DAY_ONE = "2026-11-05T05:00:00.000Z"; // 10:30 IST, 5 Nov
const DAY_ONE_LATER = "2026-11-05T09:00:00.000Z"; // 14:30 IST, 5 Nov
const DAY_TWO = "2026-11-06T04:00:00.000Z"; // 09:30 IST, 6 Nov

describe("CumulativeVolumeTracker", () => {
  it("has no traded volume for the first tick of an instrument", () => {
    expect(new CumulativeVolumeTracker().traded("NSE:X", 5_000_000, DAY_ONE)).toBeUndefined();
  });

  it("reports the volume traded since the previous tick", () => {
    const tracker = new CumulativeVolumeTracker();
    tracker.traded("NSE:X", 5_000_000, DAY_ONE);
    expect(tracker.traded("NSE:X", 5_000_100, DAY_ONE)).toBe(100);
    expect(tracker.traded("NSE:X", 5_000_100, DAY_ONE_LATER)).toBe(0);
  });

  it("treats an out-of-order lower volume within a session as nothing traded", () => {
    const tracker = new CumulativeVolumeTracker();
    tracker.traded("NSE:X", 5_000_000, DAY_ONE);
    tracker.traded("NSE:X", 5_000_100, DAY_ONE);
    expect(tracker.traded("NSE:X", 4_999_900, DAY_ONE)).toBe(0);
    // The late snapshot does not lower the baseline, so nothing is counted twice.
    expect(tracker.traded("NSE:X", 5_000_200, DAY_ONE)).toBe(100);
  });

  it("starts a new baseline when the IST trading date changes", () => {
    const tracker = new CumulativeVolumeTracker();
    tracker.traded("NSE:X", 5_000_000, DAY_ONE);
    expect(tracker.traded("NSE:X", 1_200, DAY_TWO)).toBe(1_200);
    expect(tracker.traded("NSE:X", 1_500, DAY_TWO)).toBe(300);
  });

  it("tracks instruments independently", () => {
    const tracker = new CumulativeVolumeTracker();
    tracker.traded("NSE:X", 100, DAY_ONE);
    expect(tracker.traded("BSE:X", 500, DAY_ONE)).toBeUndefined();
    expect(tracker.traded("NSE:X", 150, DAY_ONE)).toBe(50);
  });
});

describe("tickLiquidityCap", () => {
  it("fills nothing when nothing traded or the baseline is unknown", () => {
    expect(tickLiquidityCap(undefined)).toBe(0);
    expect(tickLiquidityCap(0)).toBe(0);
    expect(tickLiquidityCap(Number.NaN)).toBe(0);
    expect(tickLiquidityCap(1)).toBe(1);
    expect(tickLiquidityCap(19)).toBe(1);
    expect(tickLiquidityCap(20)).toBe(2);
  });

  it("never lets a resting order take more than traded across a session (seeded cumulative feeds)", () => {
    let state = 0x7ac;
    const random = () => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return state / 4_294_967_296;
    };
    for (let trial = 0; trial < 200; trial++) {
      const tracker = new CumulativeVolumeTracker();
      let cumulative = Math.floor(random() * 1_000_000);
      let traded = 0;
      let fillable = 0;
      for (let tick = 0; tick < 100; tick++) {
        // Quote-only repeats, out-of-order snapshots and real trades, interleaved.
        const roll = random();
        const reported = roll < 0.3 ? cumulative : roll < 0.4 ? Math.max(0, cumulative - 50) : (cumulative += 1 + Math.floor(random() * 300));
        const delta = tracker.traded("NSE:X", reported, DAY_ONE);
        const cap = tickLiquidityCap(delta);
        if (!delta) expect(cap).toBe(0);
        traded += delta ?? 0;
        fillable += cap;
      }
      expect(fillable).toBeLessThanOrEqual(traded);
    }
  });
});
