import type { NitroAppPlugin } from "nitropack";
import { readStrategyJobSettings } from "../config";
import { createStrategyJobRunner } from "../modules/strategy-jobs/runner";

/**
 * Runs queued Strategy Lab jobs (backtests, parameter sweeps, walk-forward runs) inside the web
 * process: the Render free plan has one instance and no background workers. Disable with
 * STRATEGY_JOBS_IN_PROCESS=false when a standalone worker (server/scripts/strategy-job-worker.ts)
 * runs the queue instead.
 */
const strategyJobsPlugin: NitroAppPlugin = (nitroApp) => {
  const settings = readStrategyJobSettings();
  if (!settings.inProcess) return;

  const runner = createStrategyJobRunner({ jobTimeBudgetMs: settings.jobTimeBudgetMs });
  runner.start();
  nitroApp.hooks.hook("close", () => runner.stop());
};

export default strategyJobsPlugin;
