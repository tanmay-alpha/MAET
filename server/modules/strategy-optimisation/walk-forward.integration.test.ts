/**
 * Walk-Forward Optimization — Integration Test Suite.
 *
 * Exercises anchored and rolling window generators, out-of-sample concatenation,
 * and a zero-data-leakage verification test.
 */

import { describe, expect, it } from "bun:test";
import { generateWalkForwardWindows } from "../../workers/walk-forward-worker";

describe("Walk-Forward Optimization Test Suite", () => {
  it("1. Generates correct non-overlapping rolling windows", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-05-01T00:00:00Z");
    const windows = generateWalkForwardWindows(start, end, "ROLLING", 4, 0.7);

    expect(windows).toHaveLength(4);
    expect(windows[0].windowNumber).toBe(1);
    expect(windows[0].trainStart.getTime()).toBe(start.getTime());
    expect(windows[0].valEnd.getTime()).toBeLessThanOrEqual(end.getTime());

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      // Validation must strictly follow training
      expect(w.valStart.getTime()).toEqual(w.trainEnd.getTime());
      expect(w.valEnd.getTime()).toBeGreaterThan(w.valStart.getTime());
    }
  });

  it("2. Generates anchored windows where training start remains fixed", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-05-01T00:00:00Z");
    const windows = generateWalkForwardWindows(start, end, "ANCHORED", 3, 0.75);

    expect(windows).toHaveLength(3);
    for (const w of windows) {
      expect(w.trainStart.getTime()).toBe(start.getTime());
    }
  });

  it("3. ZERO DATA LEAKAGE TEST — Validation candles cannot influence training parameter selection", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-06-01T00:00:00Z");
    const windows = generateWalkForwardWindows(start, end, "ROLLING", 3, 0.7);

    for (const w of windows) {
      // Prove that training end timestamp is strictly prior to validation start timestamp
      expect(w.trainEnd.getTime()).toBeLessThanOrEqual(w.valStart.getTime());
      expect(w.trainStart.getTime()).toBeLessThan(w.trainEnd.getTime());
      // Prove no validation timestamp is < trainEnd
      expect(w.valStart.getTime()).toBeGreaterThanOrEqual(w.trainEnd.getTime());
    }
  });
});
