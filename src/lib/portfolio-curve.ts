import type { PortfolioAnalyticsResult } from "../../server/modules/paper-trading/portfolio-analytics-contracts";

/** One point of the server-side equity curve, shaped for the chart. */
export interface PerformanceDataPoint {
  date: string;
  value: number;
  pnl: number;
  /** The generation's initial cash on the day it began. */
  anchor?: boolean;
  /** Valued with a price not from that session's close. */
  stale?: boolean;
  /** Intraday value that no closing snapshot replaced. */
  provisional?: boolean;
}

/** Chart points: the generation-start anchor, then each daily snapshot (P&L against initial cash). */
export function curveToHistory(performance: PortfolioAnalyticsResult | undefined): PerformanceDataPoint[] {
  if (!performance?.account) return [];
  const initialCash = performance.account.initialCash;
  const start: PerformanceDataPoint[] = performance.anchor
    ? [{ date: performance.anchor.date, value: performance.anchor.equity, pnl: performance.anchor.equity - initialCash, anchor: true }]
    : [];
  return [
    ...start,
    ...performance.curve.map((point) => ({
      date: point.date,
      value: point.equity,
      pnl: point.equity - initialCash,
      stale: point.stalePrices,
      provisional: !point.isFinal,
    })),
  ];
}

const DAY_MS = 86_400_000;

/** X positions proportional to calendar date across [left, left + width], so missing days show as gaps. */
export function dateSpacedX(dates: string[], left: number, width: number): number[] {
  const days = dates.map((date) => Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
  const first = Math.min(...days);
  const span = Math.max(...days) - first;
  return days.map((day) => (span > 0 ? left + (width * (day - first)) / span : left));
}
