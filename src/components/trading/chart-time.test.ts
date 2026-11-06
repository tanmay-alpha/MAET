import { describe, expect, test } from "bun:test";
import { TickMarkType, type Time, type UTCTimestamp } from "lightweight-charts";
import { formatIstCrosshairTime, formatIstTickMark, hasIntradayBars } from "./chart-time";

/** Bar time as Lightweight Charts gets it: UTC seconds. */
const at = (iso: string) => (Date.parse(iso) / 1000) as UTCTimestamp;

describe("chart times in IST", () => {
  test("NSE's 03:45 UTC open is 09:15 on the axis and the crosshair", () => {
    expect(formatIstTickMark(at("2026-11-06T03:45:00Z"), TickMarkType.Time)).toBe("09:15");
    expect(formatIstTickMark(at("2026-11-06T10:00:00Z"), TickMarkType.Time)).toBe("15:30");
    expect(formatIstCrosshairTime(at("2026-11-06T03:45:00Z"), true)).toBe("06 Nov '26 09:15");
  });

  test("a daily bar shows its date, never a time of day", () => {
    expect(formatIstCrosshairTime(at("2026-11-06T03:45:00Z"), false)).toBe("06 Nov '26");
    // A bar stamped at UTC midnight would read 05:30 if a time were shown.
    expect(formatIstCrosshairTime(at("2026-11-06T00:00:00Z"), false)).toBe("06 Nov '26");
    expect(formatIstCrosshairTime({ year: 2026, month: 11, day: 6 }, true)).toBe("06 Nov '26");
    expect(formatIstCrosshairTime("2026-11-06" as Time, true)).toBe("06 Nov '26");
    expect(formatIstTickMark({ year: 2026, month: 11, day: 6 }, TickMarkType.Time)).toBe("6");
  });

  test("the date turns over at midnight IST, 18:30 UTC", () => {
    expect(formatIstCrosshairTime(at("2026-11-06T18:29:00Z"), true)).toBe("06 Nov '26 23:59");
    expect(formatIstCrosshairTime(at("2026-11-06T18:30:00Z"), true)).toBe("07 Nov '26 00:00");
    expect(formatIstTickMark(at("2026-11-06T18:29:00Z"), TickMarkType.DayOfMonth)).toBe("6");
    expect(formatIstTickMark(at("2026-11-06T18:30:00Z"), TickMarkType.DayOfMonth)).toBe("7");
    expect(formatIstTickMark(at("2025-12-31T18:30:00Z"), TickMarkType.Year)).toBe("2026");
    expect(formatIstTickMark(at("2026-01-31T18:30:00Z"), TickMarkType.Month)).toBe("Feb");
  });

  test("each tick-mark type", () => {
    const open = at("2026-11-06T03:45:30Z");
    expect(formatIstTickMark(open, TickMarkType.Year)).toBe("2026");
    expect(formatIstTickMark(open, TickMarkType.Month)).toBe("Nov");
    expect(formatIstTickMark(open, TickMarkType.DayOfMonth)).toBe("6");
    expect(formatIstTickMark(open, TickMarkType.Time)).toBe("09:15");
    expect(formatIstTickMark(open, TickMarkType.TimeWithSeconds)).toBe("09:15:30");
    // Spelled out: ICU versions disagree on "Sep" or "Sept".
    expect(formatIstTickMark(at("2026-09-01T03:45:00Z"), TickMarkType.Month)).toBe("Sep");
  });
});

describe("hasIntradayBars", () => {
  const open = at("2026-11-02T03:45:00Z");

  test("five-minute bars across sessions are intraday", () => {
    const bars = [0, 5, 10, 15].map((m) => open + m * 60);
    expect(hasIntradayBars([...bars, ...bars.map((t) => t + 86_400)])).toBe(true);
  });

  test("daily bars with weekends and weekly bars are not", () => {
    const days = [0, 1, 2, 3, 4, 7, 8].map((d) => open + d * 86_400);
    expect(hasIntradayBars(days)).toBe(false);
    expect(hasIntradayBars([0, 7, 14].map((d) => open + d * 86_400))).toBe(false);
  });

  test("a single bar or none is shown as a date", () => {
    expect(hasIntradayBars([open])).toBe(false);
    expect(hasIntradayBars([])).toBe(false);
  });
});
