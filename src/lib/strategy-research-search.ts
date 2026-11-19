/**
 * Strategy research page navigation. The route's `validateSearch` lives in the route tree that
 * every page loads, so this stays apart from the job views and helpers in `strategy-jobs.ts`.
 */
import type { JobKind } from "./strategy-jobs";

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
