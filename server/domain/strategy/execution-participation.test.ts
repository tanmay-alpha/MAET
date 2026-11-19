/**
 * Participation cap invariant: a capped order fills at most floor(referenceVolume * rate) whole
 * shares, and nothing (with a rejection reason) when that is 0 or the volume is unusable. A cap of
 * zero used to be rounded up to one share: volume 5 at 10% filled 1 share, 20% of the bar.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { ExecutionModel, type SingleFillResult } from "./execution-model";

const BAR: Candle = { symbol: "AAA", tf: "1d", ts: "2024-01-02T03:45:00.000Z", open: 100, high: 102, low: 98, close: 101, volume: 1_000, source: "test" };

function config(maxParticipationRate: number): StrategyExecutionConfig {
  return {
    fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "FIXED_BPS", feeBps: 10, slippageBps: 5,
    initialCapital: 100_000, spreadModel: "FIXED_BPS", baseSpreadBps: 10, marketImpactModel: "SQUARE_ROOT",
    impactCoefficient: 10, maxParticipationRate,
  };
}

function fill(referenceVolume: number, rate: number, quantity: number, enforceParticipationCap = true): SingleFillResult {
  const cfg = config(rate);
  return new ExecutionModel(cfg).executeBarFill(
    { bar: BAR, orderQuantity: quantity, side: "BUY", referenceVolume, config: cfg },
    quantity,
    { enforceParticipationCap },
  );
}

/** mulberry32: small deterministic PRNG so the property loop is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectUnfilled(result: SingleFillResult) {
  expect(result.fillQuantity).toBe(0);
  expect(result.notional).toBe(0);
  expect(result.costs.totalTransactionCost).toBe(0);
  expect(result.impactBps).toBe(0);
}

describe("ExecutionModel participation cap", () => {
  it("fills nothing when floor(volume x rate) is 0 instead of forcing one share", () => {
    const result = fill(5, 0.1, 10);
    expectUnfilled(result);
    expect(result.rejectionReason).toBe("PARTICIPATION_CAP");
    expect(new ExecutionModel(config(0.1)).getMaximumBarFillQuantity(5)).toBe(0);
  });

  it("fills nothing when the reference volume is zero, negative, NaN, infinite or missing", () => {
    for (const volume of [0, -1, -500, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      for (const rate of [0.05, 0.1, 1]) {
        const result = fill(volume, rate, 10);
        expectUnfilled(result);
        expect(result.rejectionReason).toBe("NO_REFERENCE_VOLUME");
      }
    }
  });

  it("caps fractional volumes at floor(volume x rate)", () => {
    expect(fill(9.99, 0.1, 10).fillQuantity).toBe(0);
    expect(fill(9.99, 0.1, 10).rejectionReason).toBe("PARTICIPATION_CAP");
    expect(fill(0.5, 1, 10).fillQuantity).toBe(0);
    expect(fill(25.5, 0.1, 10).fillQuantity).toBe(2);
    expect(fill(25.5, 1, 100).fillQuantity).toBe(25);
  });

  it("never fills more than floor(volume x min(1, rate)), and fills exactly that when the order is larger", () => {
    const random = prng(20261110);
    const rates = [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1];
    for (let n = 0; n < 2_000; n++) {
      const scale = [1, 10, 100, 10_000][Math.floor(random() * 4)];
      const volume = random() < 0.3 ? random() * scale : Math.floor(random() * scale);
      const rate = rates[Math.floor(random() * rates.length)];
      const quantity = 1 + Math.floor(random() * 500);
      const cap = Math.floor(volume * rate);
      const result = fill(volume, rate, quantity);

      expect(Number.isInteger(result.fillQuantity)).toBe(true);
      expect(result.fillQuantity).toBe(Math.min(quantity, cap));
      if (result.fillQuantity === 0) {
        expectUnfilled(result);
        expect(result.rejectionReason).toBe(volume > 0 ? "PARTICIPATION_CAP" : "NO_REFERENCE_VOLUME");
      } else {
        expect(result.rejectionReason).toBeUndefined();
        expect(result.notional).toBeGreaterThan(0);
      }
    }
  });

  it("does not reject a zero-quantity order or an uncapped exit", () => {
    expect(fill(1_000, 0.1, 0).rejectionReason).toBeUndefined();
    // Forced exits close the whole position whatever the volume.
    for (const volume of [0, Number.NaN, 5]) {
      const exit = fill(volume, 0.1, 40, false);
      expect(exit.fillQuantity).toBe(40);
      expect(exit.rejectionReason).toBeUndefined();
    }
  });
});
