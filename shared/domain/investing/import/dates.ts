import { twelveMonthAnniversary } from "../capital-gains";

/** Calendar dates are "YYYY-MM-DD" strings, as the capital-gains engine expects. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TIME = String.raw`(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]m)?\s*(Z|UTC|GMT|IST|[+-]\d{2}:?\d{2})?)?\s*$`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}`, "i");
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME}`, "i");
const DAY_MONTH_NAME = new RegExp(String.raw`^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -]+(\d{4})${TIME}`, "i");
/** Excel's day count (1900 system) when a date cell is saved unformatted. */
const EXCEL_SERIAL = /^(\d{5})(\.\d+)?$/;
/** Serials of 1990-01-01 and 2099-12-31: any other five-digit number is not a trade date. */
const EXCEL_SERIAL_RANGE = [32874, 73050];
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const IST_OFFSET_MINUTES = 330;

const pad = (value: number) => String(value).padStart(2, "0");

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Minutes east of UTC for a zone suffix, or null when it is not a real offset. */
function zoneOffset(zone: string): number | null {
  const upper = zone.toUpperCase();
  if (upper === "Z" || upper === "UTC" || upper === "GMT") return 0;
  if (upper === "IST") return IST_OFFSET_MINUTES;
  const [, sign, hours, minutes] = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
  if (Number(hours) > 14 || Number(minutes) > 59) return null;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

function istDateTime(utcMs: number) {
  const ist = new Date(utcMs + IST_OFFSET_MINUTES * 60_000);
  return {
    date: `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`,
    time: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`,
  };
}

function build(year: number, month: number, day: number, time: Array<string | undefined>) {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  let hour = Number(time[0] ?? 0);
  const minute = Number(time[1] ?? 0);
  const second = Number(time[2] ?? 0);
  const meridiem = time[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  const offset = time[4] ? zoneOffset(time[4]) : IST_OFFSET_MINUTES;
  if (offset === null) return null;
  return istDateTime(Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000);
}

/**
 * Accepts YYYY-MM-DD (Zerodha; also YYYY/MM/DD), DD-MM-YYYY or DD/MM/YYYY
 * (Groww, Indian spreadsheets) and "7 Mar 2025", each optionally followed by a
 * 24-hour or am/pm time, plus Excel serial day numbers. Slashed dates are
 * always day-first, never US month-first. A time without a zone is Indian
 * wall-clock time; one with a zone (Z, UTC, +05:30, IST) is converted to IST,
 * because the trade date that matters for tax is the Indian calendar date.
 */
export function parseTradeDate(input: string): { date: string; time: string } | null {
  const text = input.trim();
  let match = YEAR_FIRST.exec(text);
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]), match.slice(4));
  match = DAY_FIRST.exec(text);
  if (match) return build(Number(match[3]), Number(match[2]), Number(match[1]), match.slice(4));
  match = DAY_MONTH_NAME.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2]!.toLowerCase()) + 1;
    return month === 0 ? null : build(Number(match[3]), month, Number(match[1]), match.slice(4));
  }
  match = EXCEL_SERIAL.exec(text);
  if (match) {
    const days = Number(match[1]);
    if (days < EXCEL_SERIAL_RANGE[0]! || days > EXCEL_SERIAL_RANGE[1]!) return null;
    // The fraction is wall-clock time of day, already Indian; capped so 0.99999 cannot roll into the next day.
    const seconds = Math.min(Math.round(Number(match[2] ?? 0) * 86_400), 86_399);
    return istDateTime(EXCEL_EPOCH + days * 86_400_000 + seconds * 1000 - IST_OFFSET_MINUTES * 60_000);
  }
  return null;
}

/** Start year of the Indian financial year (April to March) containing date. */
export function financialYearStart(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

export const financialYearLabel = (start: number) => `FY ${start}-${String(start + 1).slice(-2)}`;

export function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/** First sale date that counts as long-term: the day after the twelve-month anniversary. */
export function ltcgEligibleFrom(buyDate: string): string {
  return addDays(twelveMonthAnniversary(buyDate), 1);
}
