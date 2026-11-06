/**
 * Chart Time
 * Labels Lightweight Charts' time axis and crosshair in exchange time (IST).
 * Bars keep their UTC timestamps so markers and overlays stay on them; only
 * the text changes.
 */

import { TickMarkType, type Time } from "lightweight-charts";

/** "Sep", not ICU's "Sep"/"Sept" depending on version. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const IST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** A business day ("2026-11-06" or {year, month, day}) carries no time of day. */
  dateOnly: boolean;
}

/** UTC seconds read on an IST wall clock; business days read as written. */
function istWallClock(time: Time | number): WallClock {
  if (typeof time === "number") {
    const parts: Record<string, number> = {};
    for (const { type, value } of IST_PARTS.formatToParts(time * 1000)) parts[type] = Number(value);
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second, dateOnly: false };
  }
  const [year, month, day] = typeof time === "string" ? time.split("-").map(Number) : [time.year, time.month, time.day];
  return { year, month, day, hour: 0, minute: 0, second: 0, dateOnly: true };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Time-axis label for `timeScale.tickMarkFormatter`: "2026", "Nov", "6", "09:15", "09:15:30". */
export function formatIstTickMark(time: Time | number, tickMarkType: TickMarkType): string {
  const clock = istWallClock(time);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(clock.year);
    case TickMarkType.Month:
      return MONTHS[clock.month - 1];
    case TickMarkType.DayOfMonth:
      return String(clock.day);
    case TickMarkType.Time:
      return clock.dateOnly ? String(clock.day) : `${pad(clock.hour)}:${pad(clock.minute)}`;
    case TickMarkType.TimeWithSeconds:
      return clock.dateOnly ? String(clock.day) : `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`;
  }
}

/**
 * Crosshair label for `localization.timeFormatter`: "06 Nov '26 09:15" for
 * intraday bars, "06 Nov '26" for daily and longer bars.
 */
export function formatIstCrosshairTime(time: Time | number, intraday: boolean): string {
  const clock = istWallClock(time);
  const date = `${pad(clock.day)} ${MONTHS[clock.month - 1]} '${pad(clock.year % 100)}`;
  return intraday && !clock.dateOnly ? `${date} ${pad(clock.hour)}:${pad(clock.minute)}` : date;
}

/** True when bars are shorter than a day (median gap), so the crosshair shows a time. */
export function hasIntradayBars(barTimesSec: number[]): boolean {
  if (barTimesSec.length < 2) return false;
  const gaps = barTimesSec
    .slice(1)
    .map((t, i) => t - barTimesSec[i])
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] < 86_400;
}
