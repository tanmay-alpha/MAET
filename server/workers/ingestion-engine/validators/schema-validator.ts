/**
 * Validators — schema and range checks for ingested daily bars.
 *
 * A bar reaches `candles` only when it is structurally valid and internally
 * consistent; everything else is rejected and counted, never repaired.
 */

import { z } from "zod";

export const OHLCVRowSchema = z.object({
  symbol: z.string().min(1).max(30),
  /** Provider bar timestamp, stored verbatim as `candles.ts`. */
  ts: z.string().datetime({ offset: true }),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().int().min(0),
  source_tag: z.string().min(1),
});

export type OHLCVRow = z.infer<typeof OHLCVRowSchema>;

export interface BarRejection {
  row: unknown;
  reasons: string[];
}

export interface BarValidationResult {
  valid: OHLCVRow[];
  rejected: BarRejection[];
}

const MIN_BAR_TIME = Date.parse("1990-01-01T00:00:00Z");
/** Sanity ceiling: the highest-priced NSE equity trades far below this. */
const MAX_PRICE_INR = 1_000_000;

/** Reasons a schema-valid bar is not a real trading bar; empty when it is. */
export function barRangeViolations(row: OHLCVRow, now: Date): string[] {
  const reasons: string[] = [];
  for (const field of ["open", "high", "low", "close"] as const) {
    if (row[field] <= 0) reasons.push(`${field} must be positive`);
  }
  if (row.high < row.low) reasons.push("high must be >= low");
  if (row.open < row.low || row.open > row.high) reasons.push("open must lie within [low, high]");
  if (row.close < row.low || row.close > row.high) reasons.push("close must lie within [low, high]");
  if (row.high > MAX_PRICE_INR) reasons.push(`high exceeds ${MAX_PRICE_INR} INR`);
  const time = Date.parse(row.ts);
  if (time < MIN_BAR_TIME || time > now.getTime()) reasons.push("ts out of valid range");
  return reasons;
}

/**
 * Split raw rows into bars safe to upsert and rejected bars with reasons.
 * A second bar for an already accepted (symbol, ts) is rejected: one upsert
 * statement cannot touch the same `candles` key twice, and the provider
 * should never send two bars for one session.
 */
export function validateDailyBars(rows: unknown[], now = new Date()): BarValidationResult {
  const valid: OHLCVRow[] = [];
  const rejected: BarRejection[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const parsed = OHLCVRowSchema.safeParse(row);
    if (!parsed.success) {
      rejected.push({ row, reasons: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`) });
      continue;
    }
    const reasons = barRangeViolations(parsed.data, now);
    const key = `${parsed.data.symbol}|${Date.parse(parsed.data.ts)}`;
    if (reasons.length === 0 && seen.has(key)) reasons.push("duplicate bar for symbol and ts");
    if (reasons.length > 0) {
      rejected.push({ row, reasons });
      continue;
    }
    seen.add(key);
    valid.push(parsed.data);
  }

  return { valid, rejected };
}
