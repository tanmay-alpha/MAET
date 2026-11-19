import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import { companies, corporateActions } from "../../db/schema";
import type { CorporateAction, CorporateActionType } from "../../domain/data/corporate-actions";
import { istDateKey } from "../../domain/market/clock";
import { istMidnight, type CorporateActionRow } from "./mapping";

export type UpsertCounts = { inserted: number; updated: number; unchanged: number };

/**
 * Upserts on (symbol, action_type, ex_date). A row is rewritten only when it
 * came from the same source and a stored value differs, so re-running an
 * ingestion leaves unchanged rows (and their ingested_at) untouched and never
 * overwrites another source's row for the same event.
 */
export async function upsertCorporateActions(rows: CorporateActionRow[]): Promise<UpsertCounts> {
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const written = await db
    .insert(corporateActions)
    .values(rows)
    .onConflictDoUpdate({
      target: [corporateActions.symbol, corporateActions.actionType, corporateActions.exDate],
      set: {
        companyId: sql`excluded.company_id`,
        amount: sql`excluded.amount`,
        currency: sql`excluded.currency`,
        ratioNumerator: sql`excluded.ratio_numerator`,
        ratioDenominator: sql`excluded.ratio_denominator`,
        details: sql`excluded.details`,
        sourceReference: sql`excluded.source_reference`,
        ingestedAt: sql`now()`,
      },
      setWhere: sql`corporate_actions.source = excluded.source
        AND (corporate_actions.company_id, corporate_actions.amount, corporate_actions.currency,
             corporate_actions.ratio_numerator, corporate_actions.ratio_denominator,
             corporate_actions.details, corporate_actions.source_reference)
        IS DISTINCT FROM
            (excluded.company_id, excluded.amount, excluded.currency,
             excluded.ratio_numerator, excluded.ratio_denominator,
             excluded.details, excluded.source_reference)`,
    })
    // xmax is 0 only on a freshly inserted tuple.
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  const inserted = written.filter((row) => row.inserted).length;
  return { inserted, updated: written.length - inserted, unchanged: rows.length - written.length };
}

/** The subset of `symbols` that has a companies row (corporate_actions.company_id references it). */
export async function loadCompanyIds(symbols: readonly string[]): Promise<Set<string>> {
  if (symbols.length === 0) return new Set();
  const rows = await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, [...symbols]));
  return new Set(rows.map((row) => row.id));
}

const PRICE_ACTION_TYPES: Partial<Record<string, true>> = { SPLIT: true, REVERSE_SPLIT: true, BONUS: true, DIVIDEND: true, RIGHTS: true };

/**
 * Stored splits, bonuses, dividends and rights issues for `symbol` whose IST
 * ex-date falls on an IST date from `from` to `to` inclusive, oldest first,
 * with `exDate` as that IST date.
 */
export async function loadCorporateActions(symbol: string, from: Date, to: Date): Promise<CorporateAction[]> {
  const rows = await db
    .select()
    .from(corporateActions)
    .where(and(
      eq(corporateActions.symbol, symbol),
      gte(corporateActions.exDate, istMidnight(istDateKey(from))),
      lte(corporateActions.exDate, istMidnight(istDateKey(to))),
    ))
    .orderBy(asc(corporateActions.exDate), asc(corporateActions.actionType));
  return rows.flatMap((row): CorporateAction[] => {
    if (!row.exDate || !PRICE_ACTION_TYPES[row.actionType]) return [];
    const actionType = row.actionType as CorporateActionType;
    return [{
      id: row.id,
      companyId: row.companyId ?? undefined,
      symbol: row.symbol,
      actionType,
      exDate: istDateKey(row.exDate),
      ratioNumerator: row.ratioNumerator ?? undefined,
      ratioDenominator: row.ratioDenominator ?? undefined,
      amount: row.amount === null ? undefined : Number(row.amount),
      currency: row.currency,
      source: row.source,
      sourceReference: row.sourceReference ?? undefined,
      ingestedAt: row.ingestedAt,
    }];
  });
}
