/**
 * Standalone Strategy Lab job worker, for running the queue outside the web process (set
 * STRATEGY_JOBS_IN_PROCESS=false on the web service when using it).
 *
 *   bun run worker:strategy-jobs                     # backtests, sweeps and walk-forward runs
 *   bun run worker:strategy-jobs backtest,sweep      # only the listed kinds
 */

import { readStrategyJobSettings } from "../config";
import type { StrategyJobKind } from "../modules/strategy-jobs/repository";
import { createStrategyJobRunner, STRATEGY_JOB_HANDLERS } from "../modules/strategy-jobs/runner";

const requested = process.argv[2]?.split(",").map((kind) => kind.trim()).filter(Boolean);
const unknown = requested?.filter((kind) => !(kind in STRATEGY_JOB_HANDLERS)) ?? [];
if (unknown.length > 0) {
  console.error(`Unknown job kind(s): ${unknown.join(", ")}. Expected: ${Object.keys(STRATEGY_JOB_HANDLERS).join(", ")}`);
  process.exit(1);
}

const runner = createStrategyJobRunner({
  kinds: requested?.length ? (requested as StrategyJobKind[]) : undefined,
  jobTimeBudgetMs: readStrategyJobSettings().jobTimeBudgetMs,
});
runner.start();

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`[strategy-job-worker] ${signal} received, requeueing the running job and stopping`);
    void runner.stop().then(() => process.exit(0));
  });
}
