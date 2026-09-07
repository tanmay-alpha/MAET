import { describe, expect, it } from "bun:test";
import {
  CreateAlertInputSchema,
  CreatableAlertTypeSchema,
  isSupportedAlertType,
} from "./contracts";
import { mapRowToAlertView } from "./repository";

describe("Alerts Contract & Schema Suite (Checkpoint 1)", () => {
  it("1. Valid PRICE_ABOVE and PRICE_BELOW contracts pass schema validation", () => {
    const above = CreateAlertInputSchema.safeParse({
      symbol: "reliance",
      config: {
        type: "PRICE_ABOVE",
        threshold: 2500.5,
        mode: "one_time",
        cooldownMinutes: 30,
      },
    });
    expect(above.success).toBe(true);
    if (above.success) {
      expect(above.data.symbol).toBe("RELIANCE");
      expect(above.data.config.threshold).toBe(2500.5);
      expect(above.data.config.mode).toBe("one_time");
      expect(above.data.config.cooldownMinutes).toBe(30);
    }

    const below = CreateAlertInputSchema.safeParse({
      symbol: "  infy  ",
      config: {
        type: "PRICE_BELOW",
        threshold: 1500,
        mode: "repeating",
        cooldownMinutes: 120,
      },
    });
    expect(below.success).toBe(true);
    if (below.success) {
      expect(below.data.symbol).toBe("INFY");
      expect(below.data.config.threshold).toBe(1500);
      expect(below.data.config.mode).toBe("repeating");
    }
  });

  it("2. Valid PERCENT_CHANGE_ABOVE and PERCENT_CHANGE_BELOW pass schema validation", () => {
    const pctAbove = CreateAlertInputSchema.safeParse({
      symbol: "TCS",
      config: {
        type: "PERCENT_CHANGE_ABOVE",
        threshold: 3.5,
      },
    });
    expect(pctAbove.success).toBe(true);
    if (pctAbove.success) {
      expect(pctAbove.data.config.threshold).toBe(3.5);
      expect(pctAbove.data.config.mode).toBe("one_time");
      expect(pctAbove.data.config.cooldownMinutes).toBe(60);
    }

    const pctBelow = CreateAlertInputSchema.safeParse({
      symbol: "TCS",
      config: {
        type: "PERCENT_CHANGE_BELOW",
        threshold: -2.5,
      },
    });
    expect(pctBelow.success).toBe(true);
    if (pctBelow.success) {
      expect(pctBelow.data.config.threshold).toBe(-2.5);
    }
  });

  it("3. Valid VOLUME_ABOVE contract passes schema validation", () => {
    const vol = CreateAlertInputSchema.safeParse({
      symbol: "HDFCBANK",
      config: {
        type: "VOLUME_ABOVE",
        threshold: 5000000,
      },
    });
    expect(vol.success).toBe(true);
    if (vol.success) {
      expect(vol.data.config.threshold).toBe(5000000);
    }
  });

  it("4. Missing threshold is strictly rejected without zero fallback", () => {
    const missing = CreateAlertInputSchema.safeParse({
      symbol: "RELIANCE",
      config: {
        type: "PRICE_ABOVE",
      },
    });
    expect(missing.success).toBe(false);
  });

  it("5. Volume decimal is strictly rejected (requires integer shares)", () => {
    const decimalVol = CreateAlertInputSchema.safeParse({
      symbol: "RELIANCE",
      config: {
        type: "VOLUME_ABOVE",
        threshold: 1000.5,
      },
    });
    expect(decimalVol.success).toBe(false);
  });

  it("6. Nonfinite threshold (NaN, Infinity, -Infinity) is strictly rejected", () => {
    const nanRes = CreateAlertInputSchema.safeParse({
      symbol: "RELIANCE",
      config: {
        type: "PRICE_ABOVE",
        threshold: NaN,
      },
    });
    expect(nanRes.success).toBe(false);

    const infRes = CreateAlertInputSchema.safeParse({
      symbol: "RELIANCE",
      config: {
        type: "PRICE_ABOVE",
        threshold: Infinity,
      },
    });
    expect(infRes.success).toBe(false);

    const negInfRes = CreateAlertInputSchema.safeParse({
      symbol: "RELIANCE",
      config: {
        type: "PERCENT_CHANGE_BELOW",
        threshold: -Infinity,
      },
    });
    expect(negInfRes.success).toBe(false);
  });

  it("7. Symbol is normalized (trimmed, uppercase) and non-empty max 20", () => {
    const res = CreateAlertInputSchema.safeParse({
      symbol: "  tatamotors  ",
      config: {
        type: "PRICE_ABOVE",
        threshold: 950,
      },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.symbol).toBe("TATAMOTORS");
    }

    const empty = CreateAlertInputSchema.safeParse({
      symbol: "   ",
      config: {
        type: "PRICE_ABOVE",
        threshold: 950,
      },
    });
    expect(empty.success).toBe(false);

    const tooLong = CreateAlertInputSchema.safeParse({
      symbol: "A".repeat(25),
      config: {
        type: "PRICE_ABOVE",
        threshold: 950,
      },
    });
    expect(tooLong.success).toBe(false);
  });

  it("8. Unsupported technical types are strictly rejected for NEW creation", () => {
    const unsupportedTypes = [
      "RSI_ABOVE",
      "RSI_BELOW",
      "MACD_CROSS_ABOVE",
      "MACD_CROSS_BELOW",
      "PRICE_CROSS_SMA",
      "SCREENER_MATCH",
      "RELATIVE_VOLUME_ABOVE",
      "INDICATOR",
      "VOLUME_SPIKE",
    ];

    for (const t of unsupportedTypes) {
      const res = CreateAlertInputSchema.safeParse({
        symbol: "RELIANCE",
        config: {
          type: t,
          threshold: 50,
        },
      });
      expect(res.success).toBe(false);
    }
  });

  it("9. View mapping preserves truthful threshold and never falls back to zero", () => {
    const now = new Date();
    const rowWithValidTarget = {
      id: "11111111-1111-1111-1111-111111111111",
      userId: "00000000-0000-0000-0000-000000000001",
      symbol: "RELIANCE",
      exchange: "NSE",
      type: "PRICE_ABOVE",
      condition: "PRICE_ABOVE",
      target: "2500.5000",
      label: "Take Profit",
      enabled: true,
      mode: "ONE_TIME",
      cooldownMinutes: 60,
      triggered: false,
      triggeredAt: null,
      lastTriggeredAt: null,
      triggerCount: 0,
      message: null,
      config: { type: "PRICE_ABOVE", threshold: 2500.5 },
      createdAt: now,
      updatedAt: now,
    };

    const view = mapRowToAlertView(rowWithValidTarget);
    expect(view.threshold).toBe(2500.5);
    expect(view.supported).toBe(true);
    expect(view.symbol).toBe("RELIANCE");
    expect(view.mode).toBe("one_time");

    // Missing target -> null, NEVER 0
    const rowWithMissingTarget = {
      ...rowWithValidTarget,
      target: null as any,
      config: {} as any,
    };
    const viewMissing = mapRowToAlertView(rowWithMissingTarget);
    expect(viewMissing.threshold).toBeNull();
  });

  it("10. Supported flag is false for historical legacy alert types", () => {
    const now = new Date();
    const legacyRow = {
      id: "22222222-2222-2222-2222-222222222222",
      userId: "00000000-0000-0000-0000-000000000001",
      symbol: "TCS",
      exchange: "NSE",
      type: "RSI_ABOVE",
      condition: "RSI_ABOVE",
      target: "70.0000",
      label: "Overbought",
      enabled: false,
      mode: "ONE_TIME",
      cooldownMinutes: 60,
      triggered: false,
      triggeredAt: null,
      lastTriggeredAt: null,
      triggerCount: 0,
      message: null,
      config: { type: "RSI_ABOVE", threshold: 70 },
      createdAt: now,
      updatedAt: now,
    };

    const view = mapRowToAlertView(legacyRow);
    expect(view.supported).toBe(false);
    expect(isSupportedAlertType(legacyRow.type)).toBe(false);
  });

  it("11. Supported flag is true for all 5 creatable alert types", () => {
    for (const t of CreatableAlertTypeSchema.options) {
      expect(isSupportedAlertType(t)).toBe(true);
    }
  });

  it("12. Rearm semantics conceptually clear triggered state while preserving triggerCount", () => {
    const now = new Date();
    const triggeredRow = {
      id: "33333333-3333-3333-3333-333333333333",
      userId: "00000000-0000-0000-0000-000000000001",
      symbol: "INFY",
      exchange: "NSE",
      type: "PRICE_BELOW",
      condition: "PRICE_BELOW",
      target: "1400.0000",
      label: "Buy Dip",
      enabled: false,
      mode: "ONE_TIME",
      cooldownMinutes: 60,
      triggered: true,
      triggeredAt: now,
      lastTriggeredAt: now,
      triggerCount: 3,
      message: null,
      config: { type: "PRICE_BELOW", threshold: 1400 },
      createdAt: now,
      updatedAt: now,
    };

    const viewBefore = mapRowToAlertView(triggeredRow);
    expect(viewBefore.triggered).toBe(true);
    expect(viewBefore.triggerCount).toBe(3);

    // Conceptually rearmed state:
    const rearmedRow = {
      ...triggeredRow,
      enabled: true,
      triggered: false,
      triggeredAt: null,
      lastTriggeredAt: null,
      updatedAt: new Date(),
    };
    const viewRearmed = mapRowToAlertView(rearmedRow);
    expect(viewRearmed.enabled).toBe(true);
    expect(viewRearmed.triggered).toBe(false);
    expect(viewRearmed.triggeredAt).toBeNull();
    expect(viewRearmed.lastTriggeredAt).toBeNull();
    expect(viewRearmed.triggerCount).toBe(3); // Preserved!
  });
});
