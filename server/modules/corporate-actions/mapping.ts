import type { CorporateActionEvent } from "@shared/types";
import type { corporateActions } from "../../db/schema";

/** `corporate_actions.source` of every row this ingestion writes. */
export const CORPORATE_ACTION_SOURCE = "yahoo";

export type CorporateActionRow = typeof corporateActions.$inferInsert & {
  symbol: string;
  actionType: "DIVIDEND" | "SPLIT";
  exDate: Date;
};

export type MappedCorporateActions = {
  rows: CorporateActionRow[];
  /** Events that cannot be stored, with the reason (e.g. a ratio the integer columns cannot hold). */
  rejected: Array<{ exDate: string; kind: CorporateActionEvent["kind"]; reason: string }>;
};

/**
 * An IST calendar date as the instant ex_date stores: midnight IST. Readers
 * format `ex_date AT TIME ZONE 'Asia/Kolkata'` back to the same date.
 */
export function istMidnight(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * numerator:denominator as the smallest whole-number pair (ratio_numerator and
 * ratio_denominator are integer columns), or null when four decimals do not
 * express it exactly.
 */
export function integerRatio(numerator: number, denominator: number): [number, number] | null {
  for (const scale of [1, 10, 100, 1_000, 10_000]) {
    const n = Math.round(numerator * scale);
    const d = Math.round(denominator * scale);
    // Float noise only (1.1 * 3 is 3.3000000000000003), not a genuinely finer ratio.
    if (Math.abs(n - numerator * scale) > 1e-9 || Math.abs(d - denominator * scale) > 1e-9) continue;
    if (n <= 0 || d <= 0) return null;
    const divisor = gcd(n, d);
    const pair: [number, number] = [n / divisor, d / divisor];
    return pair[0] <= 2_147_483_647 && pair[1] <= 2_147_483_647 ? pair : null;
  }
  return null;
}

type DividendEvent = Extract<CorporateActionEvent, { kind: "dividend" }>;
type SplitEvent = Extract<CorporateActionEvent, { kind: "split" }>;

/**
 * Normalised Yahoo events for one NSE symbol as corporate_actions rows, one per
 * (symbol, action_type, ex_date): the table's upsert key. Two dividends with
 * the same ex-date are one cash payment per share of their sum; two splits on
 * one day compose. Yahoo reports NSE bonus issues as splits, so every share
 * change is stored as SPLIT with Yahoo's new-for-old ratio.
 */
export function mapCorporateActions(
  symbol: string,
  ticker: string,
  events: readonly CorporateActionEvent[],
): MappedCorporateActions {
  const dividends = new Map<string, DividendEvent[]>();
  const splits = new Map<string, SplitEvent[]>();
  for (const event of events) {
    if (event.kind === "dividend") dividends.set(event.exDate, [...(dividends.get(event.exDate) ?? []), event]);
    else splits.set(event.exDate, [...(splits.get(event.exDate) ?? []), event]);
  }

  const rows: CorporateActionRow[] = [];
  const rejected: MappedCorporateActions["rejected"] = [];
  const base = { symbol, source: CORPORATE_ACTION_SOURCE, sourceReference: ticker };

  for (const [exDate, group] of dividends) {
    const currencies = new Set(group.map((event) => event.currency));
    if (currencies.size > 1) {
      rejected.push({ exDate, kind: "dividend", reason: `dividends in ${[...currencies].join(", ")} on one ex-date` });
      continue;
    }
    const amount = group.reduce((sum, event) => sum + event.amount, 0);
    rows.push({
      ...base,
      actionType: "DIVIDEND",
      exDate: istMidnight(exDate),
      amount: Number(amount.toFixed(4)).toString(),
      currency: group[0]!.currency,
      ratioNumerator: null,
      ratioDenominator: null,
      details: JSON.stringify({
        // Yahoo restates older amounts for later splits, bonuses and rights issues.
        restatedByProvider: group.some((event) => event.adjusted),
        ...(group.length > 1 ? { components: group.map((event) => event.amount) } : {}),
      }),
    });
  }

  for (const [exDate, group] of splits) {
    const numerator = group.reduce((product, event) => product * event.numerator, 1);
    const denominator = group.reduce((product, event) => product * event.denominator, 1);
    const ratio = integerRatio(numerator, denominator);
    if (!ratio) {
      rejected.push({ exDate, kind: "split", reason: `ratio ${numerator}:${denominator} is not a whole-number ratio` });
      continue;
    }
    rows.push({
      ...base,
      actionType: "SPLIT",
      exDate: istMidnight(exDate),
      amount: null,
      ratioNumerator: ratio[0],
      ratioDenominator: ratio[1],
      details: JSON.stringify({
        mayBeBonus: true,
        ...(group.length > 1 ? { components: group.map((event) => `${event.numerator}:${event.denominator}`) } : {}),
      }),
    });
  }

  rows.sort((a, b) => a.exDate.getTime() - b.exDate.getTime() || a.actionType.localeCompare(b.actionType));
  return { rows, rejected };
}
