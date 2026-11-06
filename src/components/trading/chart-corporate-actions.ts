/**
 * Chart Corporate Actions
 * Places provider-reported dividends and splits on chart bars and formats
 * them for markers, tooltips and the stock page table.
 */

import type { CorporateActionEvent, CorporateActionsResponse } from "@shared/types";

export const CORPORATE_ACTION_SOURCE_LABEL: Record<CorporateActionsResponse["source"], string> = {
  yahoo: "Yahoo Finance",
};

export const NO_CORPORATE_ACTIONS_MESSAGE = "No dividends or splits reported by Yahoo Finance in this range.";

/** Corporate actions that fall on one chart bar; `time` is the bar's UTC seconds. */
export interface PlacedCorporateActions {
  time: number;
  events: CorporateActionEvent[];
}

const IST_OFFSET_MS = 19_800_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-08-12" → "12 Aug 2025" (spelled out: ICU versions disagree on "Sep" or "Sept"). */
export function formatExDate(exDate: string): string {
  const [year, month, day] = exDate.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function formatAmount(amount: number, currency: string): string {
  const value = amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency === "INR" ? `₹${value}` : `${currency} ${value}`;
}

/** Type label and detail, e.g. ["Split/bonus", "2 for 1 · 1:1 as bonus"]. */
export function describeCorporateAction(event: CorporateActionEvent): { label: string; detail: string } {
  if (event.kind === "dividend") {
    const amount = formatAmount(event.amount, event.currency);
    return { label: "Dividend", detail: event.splitAdjusted ? `${amount} per share (split-adjusted)` : `${amount} per share` };
  }
  const { numerator, denominator } = event;
  if (numerator < denominator) return { label: "Reverse split", detail: `${numerator} for ${denominator}` };
  // Yahoo reports an NSE bonus as a split: a 1:1 bonus arrives as 2:1.
  return { label: "Split/bonus", detail: `${numerator} for ${denominator} · ${numerator - denominator}:${denominator} as bonus` };
}

/** One tooltip line: "Dividend ₹24.00 · ex-date 12 Aug 2025 · Yahoo Finance". */
export function corporateActionTooltip(event: CorporateActionEvent, source: CorporateActionsResponse["source"] = "yahoo"): string {
  const what =
    event.kind === "dividend"
      ? `Dividend ${formatAmount(event.amount, event.currency)}${event.splitAdjusted ? " (split-adjusted)" : ""}`
      : `${describeCorporateAction(event).label} ${event.numerator} for ${event.denominator}`;
  return `${what} · ex-date ${formatExDate(event.exDate)} · ${CORPORATE_ACTION_SOURCE_LABEL[source]}`;
}

/**
 * Puts each event on the bar that contains its ex-date: the first bar of that
 * IST day (daily and intraday), otherwise the latest earlier bar if the ex-date
 * falls inside its period (weekly bars). Events outside the bars are dropped.
 * `candleTimes` are ascending bar starts in ms or s; the result is ascending.
 */
export function placeCorporateActions(candleTimes: number[], events: CorporateActionEvent[]): PlacedCorporateActions[] {
  if (candleTimes.length === 0 || events.length === 0) return [];
  const barsMs = candleTimes.map((t) => (t > 1e11 ? t : t * 1000));
  const days = barsMs.map((ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10));
  const gaps = barsMs.slice(1).map((ms, i) => ms - barsMs[i]).sort((a, b) => a - b);
  const barMs = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 86_400_000;

  const byBar = new Map<number, CorporateActionEvent[]>();
  for (const event of events) {
    let index = days.findIndex((day) => day >= event.exDate);
    if (index === -1) index = days.length;
    if (days[index] !== event.exDate) {
      // No bar on the ex-date: it belongs to the previous bar only if that bar's period covers it.
      const previous = index - 1;
      const exDateMs = Date.parse(`${event.exDate}T00:00:00Z`) - IST_OFFSET_MS;
      if (previous < 0 || exDateMs >= barsMs[previous] + barMs) continue;
      index = previous;
    }
    const time = Math.floor(barsMs[index] / 1000);
    byBar.set(time, [...(byBar.get(time) ?? []), event]);
  }
  return [...byBar.entries()].sort(([a], [b]) => a - b).map(([time, placed]) => ({ time, events: placed }));
}
