/**
 * Strategy run comparison: aligns 2-4 completed runs on the market dates they ALL cover and
 * computes every metric over that common window only, so a run is never credited for days the
 * others did not trade. Pure functions; the repository loads the runs.
 *
 * - Dates are Indian market dates (IST): a daily bar stamped 00:00 IST (18:30 UTC the day before)
 *   and intraday bars all fall on the session's date. A run's value for a date is its last equity
 *   point on that date.
 * - Equity curves are rebased to 100 on the first common date; drawdowns run from the peak inside
 *   the window.
 */

import type {
  ComparedRun,
  ComparisonFlag,
  CostAssumptions,
  RunComparison,
} from "./contracts";

const IST_OFFSET_MS = 330 * 60_000;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

export interface DatedValue {
  date: string;
  value: number;
}

export interface EquityObservation {
  timestamp: string;
  equity: number;
}

export interface TradeObservation {
  entryFillTs: string | null;
  entryPrice: number;
  entryQuantity: number;
  exitPrice: number | null;
  exitQuantity: number | null;
  fees: number;
  slippage: number;
}

export interface ComparisonInput {
  jobId: string;
  label: string;
  symbolOrUniverse: string;
  timeframe: string;
  engineVersion: string | null;
  benchmarkSymbol: string | null;
  costAssumptions: CostAssumptions;
  equity: EquityObservation[];
  trades: TradeObservation[];
}

/** YYYY-MM-DD of the Indian market date a timestamp falls on. */
export function marketDateKey(ts: string | number | Date): string {
  const ms = ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : new Date(ts).getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The last finite equity value on each market date, oldest date first. */
export function dailyCloses(points: readonly EquityObservation[]): DatedValue[] {
  const byDate = new Map<string, { at: number; value: number }>();
  for (const p of points) {
    const at = new Date(p.timestamp).getTime();
    if (!Number.isFinite(at) || !Number.isFinite(p.equity)) continue;
    const date = marketDateKey(at);
    const prev = byDate.get(date);
    if (!prev || at >= prev.at) byDate.set(date, { at, value: p.equity });
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, { value }]) => ({ date, value }));
}

/**
 * Keeps only the dates present in every series. `values[i]` holds series i's value on each common
 * date; `excluded[i]` counts the dates series i had that were dropped.
 */
export function alignOnCommonDates(series: ReadonlyArray<readonly DatedValue[]>): {
  dates: string[];
  values: number[][];
  excluded: number[];
} {
  if (series.length === 0) return { dates: [], values: [], excluded: [] };
  const maps = series.map((s) => new Map(s.map((p) => [p.date, p.value])));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  return {
    dates,
    values: maps.map((m) => dates.map((d) => m.get(d)!)),
    excluded: maps.map((m) => m.size - dates.length),
  };
}

/** Values scaled so the first is `base`; null when the first is not a positive number. */
export function rebase(values: readonly number[], base = 100): number[] | null {
  if (values.length === 0 || !(values[0] > 0)) return null;
  return values.map((v) => (v / values[0]) * base);
}

/** Drawdown from the running peak at each point: value / peak − 1 (0 at a new high, −0.1 = 10% below). */
export function drawdownSeries(values: readonly number[]): number[] {
  let peak = -Infinity;
  return values.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? v / peak - 1 : 0;
  });
}

/** Largest peak-to-trough fall as a positive fraction (0.25 = 25%); 0 for fewer than two points. */
export function maxDrawdown(values: readonly number[]): number {
  return drawdownSeries(values).reduce((worst, dd) => Math.max(worst, -dd), 0);
}

/** Compound annual growth between two dated values; null over less than a day or from a non-positive start. */
export function cagr(start: number, end: number, fromDate: string, toDate: string): number | null {
  const days = (Date.parse(toDate) - Date.parse(fromDate)) / MS_PER_DAY;
  if (!(days > 0) || !(start > 0)) return null;
  if (end <= 0) return -1;
  return (end / start) ** (DAYS_PER_YEAR / days) - 1;
}

/**
 * Annualised Sharpe ratio (zero risk-free rate) of the returns between consecutive common dates.
 * Common dates can be irregular (gaps, sampled curves), so the annualisation factor is the observed
 * number of returns per calendar year rather than a fixed 252. Null with fewer than two returns or
 * no variation.
 */
export function sharpeRatio(values: readonly number[], dates: readonly string[]): number | null {
  if (values.length < 3 || values.length !== dates.length) return null;
  const days = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / MS_PER_DAY;
  if (!(days > 0)) return null;
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (!(values[i - 1] > 0)) return null;
    returns.push(values[i] / values[i - 1] - 1);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (!(std > 1e-12)) return null;
  const periodsPerYear = returns.length / (days / DAYS_PER_YEAR);
  return (mean / std) * Math.sqrt(periodsPerYear);
}

/** Trades whose entry filled on a market date inside [from, to] (inclusive). */
export function tradesEnteredInWindow<T extends Pick<TradeObservation, "entryFillTs">>(trades: readonly T[], from: string, to: string): T[] {
  return trades.filter((t) => {
    if (!t.entryFillTs) return false;
    const date = marketDateKey(t.entryFillTs);
    return date >= from && date <= to;
  });
}

/** Fees + slippage as a fraction of `capital` (0.004 = 0.4%); null for non-positive capital. */
export function costDrag(trades: readonly Pick<TradeObservation, "fees" | "slippage">[], capital: number): number | null {
  if (!(capital > 0)) return null;
  return trades.reduce((sum, t) => sum + t.fees + t.slippage, 0) / capital;
}

/**
 * Traded notional of both legs (entry and exit) divided by average equity, as a multiple:
 * buying and later selling the whole account once is a turnover of 2. Null for non-positive equity.
 */
export function turnover(trades: readonly TradeObservation[], averageEquity: number): number | null {
  if (!(averageEquity > 0)) return null;
  const notional = trades.reduce(
    (sum, t) => sum + Math.abs(t.entryPrice * t.entryQuantity) + Math.abs((t.exitPrice ?? 0) * (t.exitQuantity ?? 0)),
    0,
  );
  return notional / averageEquity;
}

/** Names of the cost/fill assumptions that are not identical across all runs. */
export function differingCostAssumptions(assumptions: readonly CostAssumptions[]): Array<keyof CostAssumptions> {
  if (assumptions.length < 2) return [];
  const keys = Object.keys(assumptions[0]) as Array<keyof CostAssumptions>;
  return keys.filter((key) => assumptions.some((a) => a[key] !== assumptions[0][key]));
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Why the compared runs are not like-for-like; empty when they are. */
export function comparisonFlags(runs: readonly ComparisonInput[]): ComparisonFlag[] {
  const flags: ComparisonFlag[] = [];
  const costFields = differingCostAssumptions(runs.map((r) => r.costAssumptions));
  if (costFields.length > 0) {
    flags.push({
      code: "COST_ASSUMPTIONS_DIFFER",
      message: `Runs used different cost or fill assumptions (${costFields.join(", ")}), so return and cost differences partly reflect the assumptions, not the strategies.`,
    });
  }
  const benchmarks = distinct(runs.map((r) => r.benchmarkSymbol ?? "none"));
  if (benchmarks.length > 1) {
    flags.push({ code: "BENCHMARK_DIFFERS", message: `Runs were measured against different benchmarks (${benchmarks.join(", ")}).` });
  }
  const timeframes = distinct(runs.map((r) => r.timeframe));
  if (timeframes.length > 1) {
    flags.push({ code: "TIMEFRAME_DIFFERS", message: `Runs used different bar timeframes (${timeframes.join(", ")}).` });
  }
  const engines = distinct(runs.map((r) => r.engineVersion ?? "not recorded"));
  if (engines.length > 1) {
    flags.push({ code: "ENGINE_VERSION_DIFFERS", message: `Runs were produced by different engine versions (${engines.join(", ")}).` });
  }
  return flags;
}

function intersectionStatement(status: RunComparison["intersection"]["status"], dates: string[]): string {
  if (status === "NO_OVERLAP") return "These runs share no market dates, so there is nothing to compare like-for-like.";
  if (status === "SINGLE_DAY") {
    return `These runs overlap on a single market date (${dates[0]}); returns, CAGR, drawdown and Sharpe need at least two common dates.`;
  }
  return `All figures cover only the ${dates.length} market dates every run has, ${dates[0]} to ${dates[dates.length - 1]}.`;
}

export function compareRuns(inputs: readonly ComparisonInput[]): RunComparison {
  const closes = inputs.map((run) => dailyCloses(run.equity));
  const aligned = alignOnCommonDates(closes);
  const { dates } = aligned;
  const status: RunComparison["intersection"]["status"] = dates.length === 0 ? "NO_OVERLAP" : dates.length === 1 ? "SINGLE_DAY" : "OK";
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;

  const runs: ComparedRun[] = inputs.map((run, i) => {
    const own = closes[i];
    const values = aligned.values[i];
    const rebased = rebase(values);
    const drawdowns = drawdownSeries(values);
    const windowTrades = from && to ? tradesEnteredInWindow(run.trades, from, to) : [];
    const startEquity = values[0];
    const averageEquity = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const measurable = status === "OK" && rebased !== null;
    return {
      jobId: run.jobId,
      label: run.label,
      symbolOrUniverse: run.symbolOrUniverse,
      timeframe: run.timeframe,
      ownWindow: { from: own[0]?.date ?? null, to: own[own.length - 1]?.date ?? null, dates: own.length },
      excludedDates: aligned.excluded[i],
      series: rebased ? dates.map((date, j) => ({ date, equity: rebased[j], drawdown: drawdowns[j] })) : [],
      metrics: {
        totalReturn: measurable ? values[values.length - 1] / startEquity - 1 : null,
        cagr: measurable ? cagr(startEquity, values[values.length - 1], from!, to!) : null,
        maxDrawdown: measurable ? maxDrawdown(values) : null,
        sharpe: measurable ? sharpeRatio(values, dates) : null,
        turnover: status === "NO_OVERLAP" ? null : turnover(windowTrades, averageEquity),
        costDrag: status === "NO_OVERLAP" ? null : costDrag(windowTrades, startEquity),
        tradeCount: status === "NO_OVERLAP" ? null : windowTrades.length,
      },
      costAssumptions: run.costAssumptions,
      benchmarkSymbol: run.benchmarkSymbol,
      engineVersion: run.engineVersion,
    };
  });

  const flags = comparisonFlags(inputs);
  return {
    intersection: { status, from, to, commonDates: dates.length, statement: intersectionStatement(status, dates) },
    runs,
    likeForLike: flags.length === 0,
    flags,
  };
}
