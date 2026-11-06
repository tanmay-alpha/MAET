/**
 * Client-side helpers for Strategy Lab jobs (backtests, parameter sweeps, walk-forward runs):
 * row shapes as the tRPC API returns them, job-state and polling rules, sweep parameter
 * discovery/ranges, and mapping stored results onto the result views.
 */

import type { WalkForwardAnalysisResult, WindowMetricsSummary } from "../../server/domain/strategy/walk-forward";

// ============================================================
// Row shapes (dates arrive as ISO strings over JSON)
// ============================================================

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type JobKind = "backtest" | "sweep" | "walk-forward";

export interface BacktestJobView {
  id: string;
  strategyVersionId: string;
  status: JobStatus;
  symbolOrUniverse: string;
  timeframe: string;
  fromDate: string;
  toDate: string;
  progress: number;
  errorCode: string | null;
  errorSummary: string | null;
  requestedAt: string;
  cancelRequestedAt: string | null;
}

export interface SweepParameterInput {
  name: string;
  path: string;
  values: number[];
}

export interface SweepView {
  id: string;
  strategyId: string;
  status: JobStatus;
  parameters: SweepParameterInput[];
  combinationCount: number;
  completedCount: number;
  symbolOrUniverse: string;
  timeframe: string;
  fromDate: string;
  toDate: string;
  createdAt: string;
}

export interface SweepResultView {
  id: string;
  combinationIndex: number;
  parameterValues: Record<string, number>;
  resultSummary: {
    sharpe: string;
    sortino: string;
    totalReturn: string;
    maxDrawdown: string;
    winRate: string;
    profitFactor: string | null;
    tradeCount: number;
  } | null;
}

export type WalkForwardStoredSummary = WalkForwardAnalysisResult["summary"] & {
  warnings: string[];
  oosEquityCurve?: Array<{ timestamp: number; equity: number }>;
};

export interface WalkForwardRunView {
  id: string;
  strategyId: string;
  mode: "ANCHORED" | "ROLLING";
  parameters: SweepParameterInput[];
  symbol: string;
  timeframe: string;
  fromDate: string;
  toDate: string;
  trainingDays: number;
  validationDays: number;
  windowCount: number;
  status: JobStatus;
  oosSummary: WalkForwardStoredSummary | { error: string } | null;
  createdAt: string;
}

export interface WalkForwardWindowView {
  windowIndex: number;
  trainingFrom: string;
  trainingTo: string;
  validationFrom: string;
  validationTo: string;
  testFrom: string | null;
  testTo: string | null;
  selectedParameters: Record<string, number> | null;
  trainingMetrics: WindowMetricsSummary | null;
  validationMetrics: { metrics: WindowMetricsSummary | null; accepted: boolean; rejectionReason: string | null } | null;
  testMetrics: WindowMetricsSummary | null;
}

// ============================================================
// Job state
// ============================================================

/** How often job lists are refetched while any job is still queued or running. */
export const ACTIVE_JOB_POLL_MS = 2_000;

export function isActiveJob(status: string): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

/** react-query `refetchInterval`: poll while something is in flight, otherwise stop. */
export function jobPollInterval(statuses: readonly string[]): number | false {
  return statuses.some(isActiveJob) ? ACTIVE_JOB_POLL_MS : false;
}

/** 0-100 progress of a sweep (combinations backtested so far). */
export function sweepProgress(sweep: Pick<SweepView, "status" | "completedCount" | "combinationCount">): number {
  if (sweep.status === "COMPLETED") return 100;
  if (sweep.combinationCount <= 0) return 0;
  return Math.min(100, Math.round((sweep.completedCount / sweep.combinationCount) * 100));
}

/** A queued backtest whose cancellation is pending is effectively cancelled: show it that way. */
export function backtestDisplayStatus(job: Pick<BacktestJobView, "status" | "cancelRequestedAt">): JobStatus | "CANCELLING" {
  if (job.cancelRequestedAt && isActiveJob(job.status)) return "CANCELLING";
  return job.status;
}

export interface JobErrorDescription {
  title: string;
  message: string;
  /** The per-user active-job cap (3 per kind) was hit: the user must wait or cancel a job. */
  isJobLimit: boolean;
}

/** User-facing description of a failed create/cancel call. */
export function describeJobError(error: unknown): JobErrorDescription {
  const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "TOO_MANY_REQUESTS") {
    return { title: "Job limit reached", message, isJobLimit: true };
  }
  if (code === "BAD_REQUEST") return { title: "Check the job settings", message, isJobLimit: false };
  return { title: "Could not start the job", message, isJobLimit: false };
}

// ============================================================
// Date window
// ============================================================

/** yyyy-mm-dd (UTC) for date inputs. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Default research window: the last `years` years up to today. */
export function defaultJobWindow(now: Date, years = 2): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return { from: toDateInput(from), to: toDateInput(now) };
}

/** Date-input values as the API's ISO datetimes: `from` at the start of its day, `to` at the end. */
export function jobWindowToIso(window: { from: string; to: string }): { from: string; to: string } | { error: string } {
  const from = new Date(`${window.from}T00:00:00.000Z`);
  const to = new Date(`${window.to}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: "Enter a valid start and end date." };
  if (from >= to) return { error: "The start date must be before the end date." };
  return { from: from.toISOString(), to: to.toISOString() };
}

// ============================================================
// Sweep parameters
// ============================================================

/** Values per parameter the API accepts (SweepParameterSchema). */
export const MAX_VALUES_PER_PARAMETER = 10;
/** Combinations a sweep may request (strategyOptimisation.createSweep). */
export const MAX_SWEEP_COMBINATIONS = 500;
/** Combinations the walk-forward engine optimises per window; extra combinations are ignored. */
export const MAX_WALK_FORWARD_COMBINATIONS = 100;

export interface SweepableParameter {
  /** Dot-path into the strategy definition, e.g. "entry.children.0.left.params.period". */
  path: string;
  /** Unique, readable name used as the parameter's key in results. */
  name: string;
  currentValue: number;
}

const SKIPPED_FIELDS: Record<string, true> = { lag: true, initialCapital: true, version: true };

/**
 * Numeric fields of a strategy definition a sweep can vary: indicator parameters, constant
 * thresholds and numeric risk/execution settings. Indicator lags and the starting capital are left
 * out: varying them is not parameter optimisation.
 */
export function discoverSweepableParameters(definition: unknown): SweepableParameter[] {
  const found: SweepableParameter[] = [];
  const nameCounts = new Map<string, number>();

  const visit = (node: unknown, path: string[], label: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, [...path, String(i)], label));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    // A plain JSON object (the definition is stored as jsonb).
    const fields = node as Record<string, unknown>;
    const operandLabel = fields.kind === "INDICATOR" && typeof fields.indicator === "string" ? `${label} ${fields.indicator}` : label;
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        if (SKIPPED_FIELDS[key]) continue;
        const base = fields.kind === "CONSTANT" && key === "value" ? `${operandLabel} threshold` : `${operandLabel} ${key}`.trim();
        const count = (nameCounts.get(base) ?? 0) + 1;
        nameCounts.set(base, count);
        found.push({ path: [...path, key].join("."), name: count === 1 ? base : `${base} #${count}`, currentValue: value });
      } else if (typeof value === "object" && value !== null) {
        visit(value, [...path, key], path.length === 0 ? key : operandLabel);
      }
    }
  };
  visit(definition, [], "");
  return found;
}

/** Inclusive arithmetic range, rounded to 6 decimals so 0.1 steps do not drift. */
export function expandRange(start: number, end: number, step: number): number[] | { error: string } {
  if (![start, end, step].every(Number.isFinite)) return { error: "Start, end and step must be numbers." };
  if (step <= 0) return { error: "Step must be greater than zero." };
  if (end < start) return { error: "End must not be below start." };
  const count = Math.floor((end - start) / step + 1e-9) + 1;
  if (count > MAX_VALUES_PER_PARAMETER) {
    return { error: `${count} values; at most ${MAX_VALUES_PER_PARAMETER} per parameter. Increase the step.` };
  }
  return Array.from({ length: count }, (_, i) => Number((start + i * step).toFixed(6)));
}

/** A starting range around the current value: about five values from half to one and a half times it. */
export function defaultRange(currentValue: number): { start: number; end: number; step: number } {
  if (Number.isInteger(currentValue) && currentValue >= 1) {
    const start = Math.max(1, Math.round(currentValue * 0.5));
    const end = Math.max(start + 1, Math.round(currentValue * 1.5));
    return { start, end, step: Math.max(1, Math.round((end - start) / 4)) };
  }
  if (currentValue === 0) return { start: 0, end: 1, step: 0.25 };
  const a = Number((currentValue * 0.5).toFixed(4));
  const b = Number((currentValue * 1.5).toFixed(4));
  const [start, end] = a <= b ? [a, b] : [b, a];
  return { start, end, step: Number(((end - start) / 4).toFixed(4)) };
}

export function combinationCount(parameters: readonly Pick<SweepParameterInput, "values">[]): number {
  return parameters.reduce((product, p) => product * p.values.length, 1);
}

// ============================================================
// Result mapping
// ============================================================

function isStoredSummary(summary: WalkForwardRunView["oosSummary"]): summary is WalkForwardStoredSummary {
  return summary !== null && !("error" in summary);
}

/** Why a walk-forward run failed, when the worker recorded it. */
export function walkForwardError(run: Pick<WalkForwardRunView, "oosSummary">): string | null {
  return run.oosSummary && "error" in run.oosSummary ? run.oosSummary.error : null;
}

const NO_METRICS: WindowMetricsSummary = { totalReturn: 0, annualisedReturn: 0, sharpe: 0, maxDrawdown: 0, tradeCount: 0, winRate: 0 };

/** A completed run and its stored windows in the shape WalkForwardView renders; null until completed. */
export function walkForwardViewResult(
  run: WalkForwardRunView,
  windows: readonly WalkForwardWindowView[],
): WalkForwardAnalysisResult | null {
  if (run.status !== "COMPLETED" || !isStoredSummary(run.oosSummary)) return null;
  const { warnings, oosEquityCurve, ...summary } = run.oosSummary;
  return {
    strategyVersionId: "",
    symbol: run.symbol,
    windowType: run.mode,
    summary,
    warnings,
    aggregateOosEquityCurve: oosEquityCurve ?? [],
    windows: windows.map((w) => ({
      windowNumber: w.windowIndex,
      trainDates: { from: w.trainingFrom, to: w.trainingTo },
      valDates: { from: w.validationFrom, to: w.validationTo },
      testDates: { from: w.testFrom ?? w.validationTo, to: w.testTo ?? w.validationTo },
      selectedParameters: w.selectedParameters ?? {},
      validationAccepted: w.validationMetrics?.accepted ?? false,
      rejectionReason: w.validationMetrics?.rejectionReason ?? null,
      isMetrics: w.trainingMetrics ?? NO_METRICS,
      valMetrics: w.validationMetrics?.metrics ?? null,
      oosMetrics: w.testMetrics,
      oosEquityCurve: [],
    })),
  };
}

// ============================================================
// Research page navigation
// ============================================================

export type ResearchTab = "backtests" | "sweeps" | "walk-forward";

export const RESEARCH_TAB_FOR_KIND: Record<JobKind, ResearchTab> = {
  backtest: "backtests",
  sweep: "sweeps",
  "walk-forward": "walk-forward",
};

export const JOB_KIND_FOR_TAB: Record<ResearchTab, JobKind> = {
  backtests: "backtest",
  sweeps: "sweep",
  "walk-forward": "walk-forward",
};

export interface StrategyResearchSearch {
  tab?: ResearchTab;
  /** Id of the selected backtest job, sweep or walk-forward run. */
  job?: string;
}

/** Search params of the strategy research page; unknown values fall back to the defaults. */
export function parseResearchSearch(search: Record<string, unknown>): StrategyResearchSearch {
  const tab = typeof search.tab === "string" && Object.hasOwn(JOB_KIND_FOR_TAB, search.tab) ? (search.tab as ResearchTab) : undefined;
  return { tab, job: typeof search.job === "string" && search.job.length > 0 ? search.job : undefined };
}
