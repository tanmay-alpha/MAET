/**
 * NSE-like trading calendar for synthetic demo data.
 *
 * A day trades when the real market clock (server/domain/market/clock.ts) reports the cash
 * session OPEN at 10:00 IST: weekends and the bundled NSE holidays (server/config.ts) are
 * closed. Holiday data exists only for the bundled years; other years skip weekends only.
 */

import { parseNseHolidays } from "../../config";
import { computePhase } from "../../domain/market/clock";

const DAY_MS = 86_400_000;
/** 10:00 IST, mid-session, as a UTC time of day. */
const MID_SESSION_UTC = "T04:30:00.000Z";
/** Daily bars are stamped at the 09:15 IST session open, as stored daily candles are. */
const SESSION_OPEN_UTC = "T03:45:00.000Z";

/** The bundled NSE holiday calendar (NSE_HOLIDAYS_JSON is ignored so seeded data is reproducible). */
export function bundledNseHolidays(): Date[] {
  return parseNseHolidays(undefined);
}

export function isDemoTradingDay(isoDate: string, holidays: Date[]): boolean {
  return computePhase(new Date(`${isoDate}${MID_SESSION_UTC}`), holidays) === "OPEN";
}

/** The session-open instant of a YYYY-MM-DD trading day. */
export function sessionOpen(isoDate: string): Date {
  return new Date(`${isoDate}${SESSION_OPEN_UTC}`);
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first `count` trading days on or after `from` (YYYY-MM-DD). */
export function tradingDaysFrom(from: string, count: number, holidays: Date[]): string[] {
  const days: string[] = [];
  for (let day = from; days.length < count; day = addDays(day, 1)) {
    if (isDemoTradingDay(day, holidays)) days.push(day);
  }
  return days;
}

/** Trading days in [from, to] (YYYY-MM-DD, inclusive). */
export function tradingDaysBetween(from: string, to: string, holidays: Date[]): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isDemoTradingDay(day, holidays)) days.push(day);
  }
  return days;
}
