import { describe, expect, it } from "bun:test";
import bundled from "../../../shared/symbols/nse-holidays.json";
import { bundledNseHolidays, isDemoTradingDay, tradingDaysBetween, tradingDaysFrom } from "./calendar";
import { generateDemoUniverse } from "./seed";
import { DEMO_COMPANIES } from "./universe";

const holidays = bundledNseHolidays();
const holidayDates = new Set(bundled.map((holiday) => holiday.date));
const weekday = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

describe("demo trading calendar", () => {
  it("excludes weekends and every bundled NSE holiday in 2026, and nothing else", () => {
    const days = tradingDaysBetween("2026-01-01", "2026-12-31", holidays);
    for (const day of days) {
      expect([0, 6]).not.toContain(weekday(day));
      expect(holidayDates.has(day)).toBe(false);
    }

    // Independent count: weekdays of 2026 minus the bundled holidays that fall on weekdays.
    let expected = 0;
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (![0, 6].includes(weekday(day)) && !holidayDates.has(day)) expected++;
    }
    expect(days).toHaveLength(expected);
  });

  it("closes on Republic Day and the weekend around it", () => {
    expect(isDemoTradingDay("2026-01-23", holidays)).toBe(true); // Friday
    expect(isDemoTradingDay("2026-01-24", holidays)).toBe(false); // Saturday
    expect(isDemoTradingDay("2026-01-25", holidays)).toBe(false); // Sunday
    expect(isDemoTradingDay("2026-01-26", holidays)).toBe(false); // Monday, Republic Day
    expect(isDemoTradingDay("2026-01-27", holidays)).toBe(true);
    expect(tradingDaysFrom("2026-01-23", 2, holidays)).toEqual(["2026-01-23", "2026-01-27"]);
  });

  it("stamps every seeded demo bar on a trading day at the 09:15 IST open", () => {
    const universe = generateDemoUniverse();
    expect([...universe.keys()]).toEqual(DEMO_COMPANIES.map((company) => company.symbol));
    for (const bars of universe.values()) {
      for (const bar of bars) {
        expect(bar.ts.endsWith("T03:45:00.000Z")).toBe(true);
        const day = bar.ts.slice(0, 10);
        expect(holidayDates.has(day)).toBe(false);
        expect([0, 6]).not.toContain(weekday(day));
      }
    }
  });
});
