/**
 * Performance metrics of a paper account's daily equity curve (one point per
 * end-of-day snapshot). Volatility and Sharpe use the backtest definitions in
 * domain/backtest/risk-metrics.ts with daily periods (252 per year):
 * - volatility = sample std(daily returns) x sqrt(252)
 * - Sharpe     = mean(r - rf_d) / sample std(r - rf_d) x sqrt(252), rf_d = (1 + rf)^(1/252) - 1
 * CAGR is annualised over calendar days, so missing snapshot days do not
 * distort it, and is only reported once the curve spans a year.
 */
import { computeMaxDrawdown, computeMetrics } from "../../domain/backtest/risk-metrics";

export interface EquitySnapshotPoint {
  /** IST trading date, YYYY-MM-DD. */
  date: string;
  equity: number;
  stalePrices: boolean;
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
  dailyReturnsCount: number;
  firstDate: string | null;
  lastDate: string | null;
  calendarDays: number;
  staleSnapshotCount: number;
  riskFreeRate: number;
  totalReturn: MetricResult;
  cagr: MetricResult;
  volatility: MetricResult;
  sharpe: MetricResult;
  maxDrawdown: DrawdownResult;
}

export const MIN_SNAPSHOTS_FOR_METRICS = 2;
export const MIN_SNAPSHOTS_FOR_VOLATILITY = 3;
export const MIN_CALENDAR_DAYS_FOR_CAGR = 365;

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function unavailable(reason: string): MetricResult {
  return { value: null, reason };
}

function drawdownWithDates(points: EquitySnapshotPoint[]): DrawdownResult {
  const depth = computeMaxDrawdown(points.map((point) => point.equity));
  if (depth <= 0) {
    return { value: 0, reason: null, peakDate: null, troughDate: null, recoveryDate: null };
  }

  let peak = points[0]!;
  let worst = { depth: 0, peak: peak, trough: peak };
  for (const point of points) {
    if (point.equity > peak.equity) peak = point;
    if (peak.equity > 0) {
      const drawdown = (peak.equity - point.equity) / peak.equity;
      if (drawdown > worst.depth) worst = { depth: drawdown, peak, trough: point };
    }
  }
  const recovery = points.find(
    (point) => point.date > worst.trough.date && point.equity >= worst.peak.equity
  );
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
  options: { riskFreeRate?: number } = {}
): PortfolioMetrics {
  const riskFreeRate = options.riskFreeRate ?? 0;
  const points = [...input].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = points[0];
  const last = points[points.length - 1];
  const base = {
    snapshotCount: points.length,
    dailyReturnsCount: Math.max(0, points.length - 1),
    firstDate: first?.date ?? null,
    lastDate: last?.date ?? null,
    calendarDays: first && last ? Math.round(dayNumber(last.date) - dayNumber(first.date)) : 0,
    staleSnapshotCount: points.filter((point) => point.stalePrices).length,
    riskFreeRate,
  };

  if (!first || !last || points.length < MIN_SNAPSHOTS_FOR_METRICS) {
    const reason = `Insufficient history: needs at least ${MIN_SNAPSHOTS_FOR_METRICS} daily snapshots, have ${points.length}`;
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
      maxDrawdown: drawdownWithDates(points),
    };
  }

  const backtestMetrics = computeMetrics(
    points.map((point) => ({ timestamp: dayNumber(point.date) * DAY_MS, equity: point.equity })),
    [],
    undefined,
    "1d",
    { riskFreeRate }
  );

  const volatility: MetricResult =
    points.length < MIN_SNAPSHOTS_FOR_VOLATILITY
      ? unavailable(
          `Insufficient history: volatility needs at least ${MIN_SNAPSHOTS_FOR_VOLATILITY} daily snapshots, have ${points.length}`
        )
      : { value: backtestMetrics.volatility, reason: null };

  const sharpe: MetricResult =
    volatility.value === null
      ? unavailable(volatility.reason!.replace("volatility", "Sharpe"))
      : volatility.value === 0
        ? unavailable("Daily returns have zero volatility; Sharpe is undefined")
        : { value: backtestMetrics.sharpe, reason: null };

  const cagr: MetricResult =
    base.calendarDays < MIN_CALENDAR_DAYS_FOR_CAGR
      ? unavailable(`CAGR needs at least one year of history, have ${base.calendarDays} days`)
      : last.equity <= 0
        ? unavailable("Ending equity is not positive; CAGR is undefined")
        : { value: (last.equity / first.equity) ** (365 / base.calendarDays) - 1, reason: null };

  return {
    ...base,
    totalReturn: { value: backtestMetrics.totalReturn, reason: null },
    cagr,
    volatility,
    sharpe,
    maxDrawdown: drawdownWithDates(points),
  };
}
