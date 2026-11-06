/**
 * Performance metrics of a paper account's daily equity curve: one point per
 * end-of-day snapshot, preceded by the generation-start anchor (initial cash
 * at the date the account was created or reset).
 *
 * - Total return and max drawdown use the whole curve, from the anchor.
 * - Volatility and Sharpe use the backtest definitions in
 *   domain/backtest/risk-metrics.ts with daily periods (252 per year):
 *     volatility = sample std(r) x sqrt(252)
 *     Sharpe     = mean(r - rf_d) / sample std(r - rf_d) x sqrt(252), rf_d = (1 + rf)^(1/252) - 1
 *   but only over consecutive-session returns. A return across missed sessions
 *   (the instance slept through a close) spans several days; annualising it as
 *   one day would overstate volatility, so it is left out and counted in
 *   gapCount instead. With fewer than 2 consecutive-session returns both are
 *   null with a reason.
 * - CAGR is annualised over calendar days, so gaps do not distort it, and is
 *   only reported once the curve spans a year.
 */
import { computeMaxDrawdown, mean, stddev, TRADING_DAYS_PER_YEAR } from "../../domain/backtest/risk-metrics";

export interface EquitySnapshotPoint {
  /** IST trading date, YYYY-MM-DD. */
  date: string;
  equity: number;
  stalePrices: boolean;
  isFinal: boolean;
}

/** Equity at the start of the account generation (its initial cash). */
export interface CurveAnchor {
  date: string;
  equity: number;
}

/** A metric value, or null with the reason it cannot be computed honestly. */
export interface MetricResult {
  value: number | null;
  reason: string | null;
}

export interface DrawdownResult extends MetricResult {
  peakDate: string | null;
  troughDate: string | null;
  /** First date equity regained the peak after the trough; null while still under water. */
  recoveryDate: string | null;
}

export interface PortfolioMetrics {
  snapshotCount: number;
  /** Consecutive-session daily returns used for volatility and Sharpe. */
  dailyReturnsCount: number;
  /** Trading sessions with no snapshot between the first and last point. */
  gapCount: number;
  /** Start of the period the metrics cover (the anchor date when there is one). */
  firstDate: string | null;
  lastDate: string | null;
  calendarDays: number;
  staleSnapshotCount: number;
  /** Past snapshots still intraday values: the instance slept through that session's close. */
  provisionalSnapshotCount: number;
  riskFreeRate: number;
  totalReturn: MetricResult;
  cagr: MetricResult;
  volatility: MetricResult;
  sharpe: MetricResult;
  maxDrawdown: DrawdownResult;
}

export interface PortfolioMetricsOptions {
  /** Annual risk-free rate as a decimal; default 0. */
  riskFreeRate?: number;
  anchor?: CurveAnchor;
  /** Trading sessions in (fromExclusive, toInclusive]; defaults to counting weekdays. */
  sessionsBetween?: (fromExclusive: string, toInclusive: string) => number;
  /** The session a snapshot taken now would value; non-final points before it are past provisional ones. */
  currentSessionDate?: string;
  /** The generation began after its start date's session closed, so that session is not part of the first return. */
  anchorStartsAfterClose?: boolean;
}

export const MIN_CONSECUTIVE_RETURNS_FOR_VOLATILITY = 2;
export const MIN_CALENDAR_DAYS_FOR_CAGR = 365;

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Weekdays in (fromExclusive, toInclusive]. */
export function weekdaysBetween(fromExclusive: string, toInclusive: string): number {
  let count = 0;
  for (let day = dayNumber(fromExclusive) + 1; day <= dayNumber(toInclusive); day++) {
    const weekday = new Date(day * DAY_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

function unavailable(reason: string): MetricResult {
  return { value: null, reason };
}

function drawdownWithDates(points: Array<{ date: string; equity: number }>): DrawdownResult {
  const depth = computeMaxDrawdown(points.map((point) => point.equity));
  if (depth <= 0) {
    return { value: 0, reason: null, peakDate: null, troughDate: null, recoveryDate: null };
  }

  let peak = points[0]!;
  let worst = { depth: 0, peak: peak, trough: peak, troughIndex: 0 };
  points.forEach((point, index) => {
    if (point.equity > peak.equity) peak = point;
    if (peak.equity > 0) {
      const drawdown = (peak.equity - point.equity) / peak.equity;
      if (drawdown > worst.depth) worst = { depth: drawdown, peak, trough: point, troughIndex: index };
    }
  });
  const recovery = points.slice(worst.troughIndex + 1).find((point) => point.equity >= worst.peak.equity);
  return {
    value: depth,
    reason: null,
    peakDate: worst.peak.date,
    troughDate: worst.trough.date,
    recoveryDate: recovery?.date ?? null,
  };
}

export function computePortfolioMetrics(
  input: EquitySnapshotPoint[],
  options: PortfolioMetricsOptions = {}
): PortfolioMetrics {
  const riskFreeRate = options.riskFreeRate ?? 0;
  const sessionsBetween = options.sessionsBetween ?? weekdaysBetween;
  const snapshots = [...input].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const anchor = options.anchor && (snapshots.length === 0 || options.anchor.date <= snapshots[0]!.date) ? options.anchor : undefined;
  const curve: Array<{ date: string; equity: number }> = anchor ? [anchor, ...snapshots] : snapshots;

  // Each step's return and the trading sessions it spans. The step from the
  // anchor includes the start date's session unless the generation began after its close.
  const steps = curve.slice(1).map((point, index) => {
    const previous = curve[index]!;
    const from =
      index === 0 && anchor
        ? options.anchorStartsAfterClose
          ? anchor.date
          : dateOfDay(dayNumber(anchor.date) - 1)
        : previous.date;
    return {
      sessions: sessionsBetween(from, point.date),
      return: previous.equity === 0 ? 0 : (point.equity - previous.equity) / previous.equity,
    };
  });
  const consecutive = steps.filter((step) => step.sessions <= 1).map((step) => step.return);
  const gapCount = steps.reduce((sum, step) => sum + Math.max(0, step.sessions - 1), 0);

  const first = curve[0];
  const last = curve[curve.length - 1];
  const base = {
    snapshotCount: snapshots.length,
    dailyReturnsCount: consecutive.length,
    gapCount,
    firstDate: first?.date ?? null,
    lastDate: last?.date ?? null,
    calendarDays: first && last ? Math.round(dayNumber(last.date) - dayNumber(first.date)) : 0,
    staleSnapshotCount: snapshots.filter((point) => point.stalePrices).length,
    provisionalSnapshotCount: snapshots.filter(
      (point) => !point.isFinal && (options.currentSessionDate === undefined || point.date < options.currentSessionDate)
    ).length,
    riskFreeRate,
  };

  if (!first || !last || curve.length < 2) {
    const reason = anchor
      ? "Insufficient history: needs at least one daily snapshot after the account started"
      : `Insufficient history: needs at least 2 daily snapshots, have ${snapshots.length}`;
    return {
      ...base,
      totalReturn: unavailable(reason),
      cagr: unavailable(reason),
      volatility: unavailable(reason),
      sharpe: unavailable(reason),
      maxDrawdown: { ...unavailable(reason), peakDate: null, troughDate: null, recoveryDate: null },
    };
  }

  if (first.equity <= 0) {
    const reason = "Starting equity is not positive; returns are undefined";
    return {
      ...base,
      totalReturn: unavailable(reason),
      cagr: unavailable(reason),
      volatility: unavailable(reason),
      sharpe: unavailable(reason),
      maxDrawdown: drawdownWithDates(curve),
    };
  }

  const annualisation = Math.sqrt(TRADING_DAYS_PER_YEAR);
  let volatility: MetricResult;
  let sharpe: MetricResult;
  if (consecutive.length < MIN_CONSECUTIVE_RETURNS_FOR_VOLATILITY) {
    const gaps = gapCount > 0 ? ` (returns across ${gapCount} missed sessions are excluded)` : "";
    const reason = `Insufficient history: needs at least ${MIN_CONSECUTIVE_RETURNS_FOR_VOLATILITY} consecutive-session daily returns, have ${consecutive.length}${gaps}`;
    volatility = unavailable(reason);
    sharpe = unavailable(reason);
  } else {
    volatility = { value: stddev(consecutive) * annualisation, reason: null };
    const dailyRiskFree = (1 + riskFreeRate) ** (1 / TRADING_DAYS_PER_YEAR) - 1;
    const excess = consecutive.map((r) => r - dailyRiskFree);
    const excessStd = stddev(excess);
    sharpe =
      excessStd > 0
        ? { value: (mean(excess) / excessStd) * annualisation, reason: null }
        : unavailable("Daily returns have zero volatility; Sharpe is undefined");
  }

  const cagr: MetricResult =
    base.calendarDays < MIN_CALENDAR_DAYS_FOR_CAGR
      ? unavailable(`CAGR needs at least one year of history, have ${base.calendarDays} days`)
      : last.equity <= 0
        ? unavailable("Ending equity is not positive; CAGR is undefined")
        : { value: (last.equity / first.equity) ** (365 / base.calendarDays) - 1, reason: null };

  return {
    ...base,
    totalReturn: { value: (last.equity - first.equity) / first.equity, reason: null },
    cagr,
    volatility,
    sharpe,
    maxDrawdown: drawdownWithDates(curve),
  };
}
