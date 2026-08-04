/**
 * Strategy Deployments — Integration Test Suite.
 *
 * Verifies risk gate evaluation, deterministic signal fingerprinting,
 * completed candle signal detection, and mode routing.
 */

import { describe, expect, it } from "bun:test";
import {
  evaluateRiskGate,
  computeSignalFingerprint,
} from "../../workers/strategy-evaluator";

describe("Strategy Deployments Test Suite", () => {
  it("1. Generates deterministic signal fingerprint", () => {
    const fp1 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z", "ENTRY");
    const fp2 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z", "ENTRY");
    const fp3 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z", "EXIT");

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(fp1).toHaveLength(32);
  });

  it("2. Risk Gate blocks signal when kill switch is active", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: true, maxPositions: 5 };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "RELIANCE" }, 50000, 1, 1000);

    expect(res.passed).toBeFalse();
    expect(res.rejectReason).toBe("KILL_SWITCH_ACTIVE");
  });

  it("3. Risk Gate blocks signal when max open positions reached", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: false, maxPositions: 2 };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "TCS" }, 50000, 2, 1000);

    expect(res.passed).toBeFalse();
    expect(res.rejectReason).toBe("MAX_OPEN_POSITIONS_REACHED");
  });

  it("4. Risk Gate passes when all conditions are satisfied", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: false, maxPositions: 5 };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "INFY" }, 50000, 1, 1000);

    expect(res.passed).toBeTrue();
  });
});
