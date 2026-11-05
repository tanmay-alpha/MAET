import { describe, expect, it } from "bun:test";
import { parseNseHolidays } from "./config";
import { computePhase, hasHolidaysForIstYear } from "./domain/market/clock";

// 2026-11-10 (Diwali-Balipratipada, a Tuesday) at 10:00 IST.
const DIWALI_MORNING = new Date("2026-11-10T04:30:00.000Z");
// 2026-12-31 (Thursday) at 10:00 IST: not an NSE holiday.
const NEW_YEARS_EVE_MORNING = new Date("2026-12-31T04:30:00.000Z");

describe("parseNseHolidays", () => {
  it("falls back to the bundled NSE calendar when NSE_HOLIDAYS_JSON is unset", () => {
    expect(computePhase(DIWALI_MORNING, parseNseHolidays(undefined))).toBe("HOLIDAY");
  });

  it("treats an empty NSE_HOLIDAYS_JSON array as unset", () => {
    expect(computePhase(DIWALI_MORNING, parseNseHolidays("[]"))).toBe("HOLIDAY");
  });

  it("adds NSE_HOLIDAYS_JSON entries to the bundled calendar", () => {
    const holidays = parseNseHolidays('["2026-12-31"]');
    expect(computePhase(NEW_YEARS_EVE_MORNING, holidays)).toBe("HOLIDAY");
    expect(computePhase(DIWALI_MORNING, holidays)).toBe("HOLIDAY");
  });

  it("does not duplicate a date present in both lists", () => {
    expect(parseNseHolidays('["2026-11-10"]')).toHaveLength(parseNseHolidays(undefined).length);
  });
});

describe("hasHolidaysForIstYear", () => {
  it("reports whether the calendar covers the current IST year", () => {
    const bundled = parseNseHolidays(undefined);
    expect(hasHolidaysForIstYear(bundled, DIWALI_MORNING)).toBe(true);
    // 2026-12-31 19:00 UTC is already 2027-01-01 in IST.
    expect(hasHolidaysForIstYear(bundled, new Date("2026-12-31T19:00:00.000Z"))).toBe(false);
  });
});
