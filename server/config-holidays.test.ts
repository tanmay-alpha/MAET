import { describe, expect, it } from "bun:test";
import { parseNseHolidays } from "./config";
import { computePhase } from "./domain/market/clock";

// 2026-11-10 (Diwali-Balipratipada, a Tuesday) at 10:00 IST.
const DIWALI_MORNING = new Date("2026-11-10T04:30:00.000Z");

describe("parseNseHolidays", () => {
  it("falls back to the bundled NSE calendar when NSE_HOLIDAYS_JSON is unset", () => {
    expect(computePhase(DIWALI_MORNING, parseNseHolidays(undefined))).toBe("HOLIDAY");
  });

  it("lets NSE_HOLIDAYS_JSON replace the bundled calendar", () => {
    const holidays = parseNseHolidays('["2026-12-31"]');
    expect(computePhase(DIWALI_MORNING, holidays)).toBe("OPEN");
    expect(computePhase(new Date("2026-12-31T04:30:00.000Z"), holidays)).toBe("HOLIDAY");
  });
});
