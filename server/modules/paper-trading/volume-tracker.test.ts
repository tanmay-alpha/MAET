import { describe, expect, it } from "bun:test";
import { CumulativeVolumeTracker } from "./volume-tracker";

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
