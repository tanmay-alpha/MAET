/**
 * Execution context the strategy job functions (backtest, sweep, walk-forward) run under.
 *
 * Jobs call `checkpoint()` between backtests and between phases. It hands control back to the event
 * loop (so an in-process runner does not starve the API it shares a process with) and throws a
 * JobInterruptedError once the runner wants the job to stop. Job functions must let that error
 * propagate: the runner decides whether the job is requeued or failed.
 */

import { setImmediate as nextTurn } from "node:timers/promises";

export type JobInterruptReason =
  /** The runner is shutting down; the job goes back to the queue. */
  | "SHUTDOWN"
  /** The job ran past the runner's per-job time budget; the job fails. */
  | "TIME_BUDGET"
  /** Another worker owns the job now (it was recovered as stale); this run's results are dropped. */
  | "LEASE_LOST";

export class JobInterruptedError extends Error {
  constructor(readonly reason: JobInterruptReason) {
    super(`Strategy job interrupted: ${reason}`);
    this.name = "JobInterruptedError";
  }
}

export interface JobContext {
  checkpoint(): Promise<void>;
}

export function createJobContext(signal: AbortSignal): JobContext {
  return {
    async checkpoint() {
      await nextTurn();
      if (signal.aborted) throw signal.reason;
    },
  };
}

/** Context for callers that run a job to completion without a runner (tests, scripts). */
export const uninterruptedJobContext: JobContext = createJobContext(new AbortController().signal);
