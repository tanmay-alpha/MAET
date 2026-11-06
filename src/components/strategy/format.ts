/**
 * Number and date formatting for the strategy research pages. Values arrive from numeric
 * Postgres columns as strings (or null), so every helper accepts unknown and renders "—"
 * for anything that is not a finite number instead of inventing a zero.
 */

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ₹ with Indian digit grouping: ₹1,00,000.00, -₹2,345.50. */
export function rupees(value: unknown, digits = 2): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const grouped = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "-" : ""}₹${grouped}`;
}

/** A fraction (0.1234) as a percentage (12.34%). */
export function percent(fraction: unknown, digits = 2): string {
  const n = toNumber(fraction);
  if (n === null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** A value that is already in percent (12.34) with its unit. */
export function percentValue(value: unknown, digits = 2): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n.toFixed(digits)}%`;
}

export function decimal(value: unknown, digits = 2): string {
  const n = toNumber(value);
  return n === null ? "—" : n.toFixed(digits);
}

/** Whole numbers with Indian grouping (12,34,567). */
export function count(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "—" : Math.round(n).toLocaleString("en-IN");
}

/** text-bull for positive, text-bear for negative, nothing for zero or unknown. */
export function signTone(value: unknown): string {
  const n = toNumber(value);
  if (n === null || n === 0) return "";
  return n > 0 ? "text-bull" : "text-bear";
}

const DATE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

function asDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 07 Nov 2026 (IST). */
export function shortDate(value: string | number | Date | null | undefined): string {
  const d = asDate(value);
  return d ? DATE.format(d) : "—";
}

/** 07 Nov 2026, 15:30 (IST). */
export function dateTime(value: string | number | Date | null | undefined): string {
  const d = asDate(value);
  return d ? DATE_TIME.format(d) : "—";
}
