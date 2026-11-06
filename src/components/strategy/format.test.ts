import { describe, expect, test } from "bun:test";
import { count, percent, rupees, signTone } from "./format";

describe("strategy number formatting", () => {
  test("rupees use Indian digit grouping and keep the sign in front of the symbol", () => {
    expect(rupees("1234567.5")).toBe("₹12,34,567.50");
    expect(rupees(-2345.5, 0)).toBe("-₹2,346");
  });

  test("missing or non-numeric values render as a dash, never as zero", () => {
    for (const value of [null, undefined, "", "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rupees(value)).toBe("—");
      expect(percent(value)).toBe("—");
      expect(count(value)).toBe("—");
      expect(signTone(value)).toBe("");
    }
  });

  test("fractions become percentages and counts are grouped", () => {
    expect(percent("0.123456")).toBe("12.35%");
    expect(count(1234567)).toBe("12,34,567");
    expect(signTone("-0.01")).toBe("text-bear");
    expect(signTone(0)).toBe("");
  });
});
