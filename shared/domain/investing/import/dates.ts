import { twelveMonthAnniversary } from "../capital-gains";

/** Calendar dates are "YYYY-MM-DD" strings, as the capital-gains engine expects. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TIME = String.raw`(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]m)?)?\s*$`;
const ISO = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}`, "i");
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME}`, "i");
const DAY_MONTH_NAME = new RegExp(String.raw`^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -]+(\d{4})${TIME}`, "i");

const pad = (value: number) => String(value).padStart(2, "0");

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}:${pad(second)}` };
}

/**
 * Accepts YYYY-MM-DD (Zerodha), DD-MM-YYYY or DD/MM/YYYY (Groww, Indian
 * spreadsheets) and "7 Mar 2025", each optionally followed by a 24-hour or
 * am/pm time. Slashed dates are always day-first, never US month-first.
 */
export function parseTradeDate(input: string): { date: string; time: string } | null {
  const text = input.trim();
  let match = ISO.exec(text);
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]), match.slice(4));
  match = DAY_FIRST.exec(text);
  if (match) return build(Number(match[3]), Number(match[2]), Number(match[1]), match.slice(4));
  match = DAY_MONTH_NAME.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2]!.toLowerCase()) + 1;
    return month === 0 ? null : build(Number(match[3]), month, Number(match[1]), match.slice(4));
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
