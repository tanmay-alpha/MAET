/**
 * Validators — Schema, Range, and Cross validation for ingestion data
 */

import { z } from "zod";

// ============================================================================
// Schema Validators (Zod-based per source)
// ============================================================================

export const OHLCVRowSchema = z.object({
  symbol: z.string().min(1).max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().int().min(0),
  source_tag: z.string().min(1),
});

export const CompanyRowSchema = z.object({
  symbol: z.string().min(1).max(30),
  name: z.string().min(1),
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{10}$/).optional().nullable(),
  exchange: z.enum(["NSE", "BSE"]),
  series: z.string().default("EQ"),
});

export const FinancialStatementRowSchema = z.object({
  companyId: z.string().min(1),
  periodDate: z.string().datetime({ offset: true }),
  periodType: z.enum(["quarterly", "annual"]),
  source: z.string().min(1),
  revenue: z.number().finite().nullable().optional(),
  netIncome: z.number().finite().nullable().optional(),
  totalAssets: z.number().finite().nullable().optional(),
  totalLiabilities: z.number().finite().nullable().optional(),
});

export const FundamentalsRowSchema = z.object({
  companyId: z.string().min(1),
  periodDate: z.string().datetime({ offset: true }),
  source: z.string().min(1),
  peRatio: z.number().finite().nullable().optional(),
  pbRatio: z.number().finite().nullable().optional(),
  roe: z.number().finite().nullable().optional(),
  marketCap: z.number().finite().min(0).nullable().optional(),
});

export type OHLCVRow = z.infer<typeof OHLCVRowSchema>;
export type CompanyRow = z.infer<typeof CompanyRowSchema>;
export type FinancialStatementRow = z.infer<typeof FinancialStatementRowSchema>;
export type FundamentalsRow = z.infer<typeof FundamentalsRowSchema>;

export interface ValidationResult<T> {
  valid: T[];
  invalid: Array<{ row: unknown; errors: string[] }>;
}

export function validateOHLCVBatch(rows: unknown[]): ValidationResult<OHLCVRow> {
  return validateBatch(rows, OHLCVRowSchema);
}

export function validateCompanyBatch(rows: unknown[]): ValidationResult<CompanyRow> {
  return validateBatch(rows, CompanyRowSchema);
}

export function validateFinancialsBatch(rows: unknown[]): ValidationResult<FinancialStatementRow> {
  return validateBatch(rows, FinancialStatementRowSchema);
}

function validateBatch<T>(rows: unknown[], schema: z.ZodType<T>): ValidationResult<T> {
  const valid: T[] = [];
  const invalid: Array<{ row: unknown; errors: string[] }> = [];

  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({
        row,
        errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      });
    }
  }

  return { valid, invalid };
}

// ============================================================================
// Range Validators
// ============================================================================

export interface RangeViolation {
  symbol: string;
  field: string;
  value: number;
  reason: string;
}

export function validateOHLCVRanges(rows: OHLCVRow[]): {
  valid: OHLCVRow[];
  violations: RangeViolation[];
} {
  const valid: OHLCVRow[] = [];
  const violations: RangeViolation[] = [];

  const now = new Date();
  const minDate = new Date("1990-01-01");

  for (const row of rows) {
    const rowViolations: RangeViolation[] = [];

    // Price must be positive
    for (const field of ["open", "high", "low", "close"] as const) {
      if (row[field] <= 0) {
        rowViolations.push({ symbol: row.symbol, field, value: row[field], reason: "price must be positive" });
      }
    }

    // OHLC consistency
    if (row.high < row.open || row.high < row.close || row.high < row.low) {
      rowViolations.push({ symbol: row.symbol, field: "high", value: row.high, reason: "high must be >= open/close/low" });
    }
    if (row.low > row.open || row.low > row.close || row.low > row.high) {
      rowViolations.push({ symbol: row.symbol, field: "low", value: row.low, reason: "low must be <= open/close/high" });
    }

    // Date in valid range
    const date = new Date(row.date);
    if (date < minDate || date > now) {
      rowViolations.push({ symbol: row.symbol, field: "date", value: date.getTime(), reason: "date out of valid range" });
    }

    // Price sanity: reject if > 1,000,000 INR (MRF is ~150k, no stock goes higher)
    if (row.close > 1_000_000) {
      rowViolations.push({ symbol: row.symbol, field: "close", value: row.close, reason: "close price exceeds 1,000,000 INR" });
    }

    if (rowViolations.length === 0) {
      valid.push(row);
    } else {
      violations.push(...rowViolations);
    }
  }

  return { valid, violations };
}

// ============================================================================
// Cross Validators
// ============================================================================

export interface CrossViolation {
  symbol?: string;
  type: string;
  message: string;
}

export function validateDateContinuity(
  rows: OHLCVRow[],
  maxGapDays = 7
): CrossViolation[] {
  const violations: CrossViolation[] = [];
  const bySymbol = new Map<string, Date[]>();

  for (const row of rows) {
    const dates = bySymbol.get(row.symbol) ?? [];
    dates.push(new Date(row.date));
    bySymbol.set(row.symbol, dates);
  }

  for (const [symbol, dates] of bySymbol.entries()) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < dates.length; i++) {
      const gapDays = (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      if (gapDays > maxGapDays) {
        violations.push({
          symbol,
          type: "DATE_GAP",
          message: `Gap of ${Math.round(gapDays)} days between ${dates[i - 1].toISOString().split("T")[0]} and ${dates[i].toISOString().split("T")[0]}`,
        });
      }
    }
  }

  return violations;
}
