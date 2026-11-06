/**
 * Strategy job runner: claims queued backtests, parameter sweeps and walk-forward runs and executes
 * them one at a time.
 *
 * It runs inside the API process (server/plugins/strategy-jobs.ts) because the Render free plan has a
 * single web instance and no background workers, and can also run standalone
 * (server/scripts/strategy-job-worker.ts). Several runners may share a database: claims use
 * FOR UPDATE SKIP LOCKED.
 *
 * - One job at a time, kinds claimed round-robin so one busy kind cannot starve the others.
 * - Jobs hand control back to the event loop between backtests (JobContext.checkpoint), so API
 *   requests keep being served while a job runs.
 * - A heartbeat keeps the running job's lease; RUNNING jobs whose heartbeat stopped (their process
 *   died) are requeued on start-up and then periodically.
 * - A job running past `jobTimeBudgetMs` is failed with TIME_BUDGET_EXCEEDED.
 * - stop() interrupts the running job at its next checkpoint and puts it back on the queue.
 */

import { randomUUID } from "node:crypto";
import * as backtests from "./repository";
import { isConnectionError, isDatabaseAvailable, recordDatabaseFailure } from "../../data/drizzle/availability";
import { DatabaseGate, type DatabaseGateLog } from "../../infra/database-gate";
import { createJobContext, JobInterruptedError, type JobContext } from "./job-context";
import * as optimisation from "../strategy-optimisation/repository";
import { runBacktestJob } from "../../workers/backtest-worker";
import { runSweepJob } from "../../workers/sweep-worker";
import { runWalkForwardJob } from "../../workers/walk-forward-worker";

export interface ClaimedJob {
  id: string;
  run(ctx: JobContext): Promise<void>;
}

/** Queue operations and job execution for one job kind. */
export interface JobKindHandler {
  claim(workerId: string): Promise<ClaimedJob | null>;
  heartbeat(id: string): Promise<void>;
  /** Back to the queue (runner shutdown). */
  release(id: string, workerId: string): Promise<void>;
  fail(id: string, code: string, message: string): Promise<void>;
  /** Requeues RUNNING jobs whose heartbeat is older than `staleAfterMs`; returns how many. */
  recoverStale(staleAfterMs: number): Promise<number>;
}

export const STRATEGY_JOB_HANDLERS: Record<backtests.StrategyJobKind, JobKindHandler> = {
  backtest: {
    async claim(workerId) {
      const job = await backtests.claimNextJob(workerId);
      return job ? { id: job.id, run: (ctx) => runBacktestJob(job, workerId, ctx) } : null;
    },
    heartbeat: backtests.updateHeartbeat,
    release: backtests.releaseJob,
    fail: backtests.markFailed,
    recoverStale: backtests.recoverAbandonedJobs,
  },
  sweep: {
    async claim() {
      const id = await optimisation.claimNextSweep();
      return id ? { id, run: (ctx) => runSweepJob(id, ctx) } : null;
    },
    heartbeat: optimisation.touchSweep,
    release: optimisation.releaseSweep,
    fail: optimisation.failSweep,
    recoverStale: optimisation.recoverStaleSweeps,
  },
  "walk-forward": {
    async claim() {
      const id = await optimisation.claimNextWalkForward();
      return id ? { id, run: (ctx) => runWalkForwardJob(id, ctx) } : null;
    },
    heartbeat: optimisation.touchWalkForward,
    release: optimisation.releaseWalkForward,
    fail: (id, _code, message) => optimisation.failWalkForward(id, message),
    recoverStale: optimisation.recoverStaleWalkForwards,
  },
};

export interface StrategyJobRunnerOptions {
  kinds?: backtests.StrategyJobKind[];
  workerId?: string;
  /** Wait between claim attempts while the queues are empty. */
  pollIntervalMs?: number;
  /** A job still running after this long is failed. */
  jobTimeBudgetMs?: number;
  heartbeatIntervalMs?: number;
  /** A RUNNING job whose heartbeat is older than this belongs to a dead worker. */
  staleAfterMs?: number;
  /** How often to look for stale jobs (also done once on start). */
  recoveryIntervalMs?: number;
  /** While false the runner does not query the queues (defaults to the database circuit breaker). */
  isDatabaseAvailable?: () => boolean;
  /** Receives the one-line outage/recovery messages (defaults to the console). */
  log?: DatabaseGateLog;
}

export interface StrategyJobRunner {
  readonly workerId: string;
  start(): void;
  /** Interrupts and requeues the running job, then resolves once the runner loop has exited. */
  stop(): Promise<void>;
}

export const DEFAULT_JOB_TIME_BUDGET_MS = 15 * 60 * 1000;

export function createStrategyJobRunner(options: StrategyJobRunnerOptions = {}): StrategyJobRunner {
  const kinds = options.kinds ?? (Object.keys(STRATEGY_JOB_HANDLERS) as backtests.StrategyJobKind[]);
  const workerId = options.workerId ?? `sjr-${randomUUID().slice(0, 8)}-${process.pid}`;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const jobTimeBudgetMs = options.jobTimeBudgetMs ?? DEFAULT_JOB_TIME_BUDGET_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  const staleAfterMs = options.staleAfterMs ?? backtests.HEARTBEAT_TIMEOUT_MS;
  const recoveryIntervalMs = options.recoveryIntervalMs ?? 60_000;
  const databaseAvailable = options.isDatabaseAvailable ?? isDatabaseAvailable;
  const tag = `[strategy-jobs:${workerId}]`;
  // Queue polls (and the half-open trial after each breaker cooldown) go through the
  // circuit; a dead database is reported once per outage, not with a query dump per poll.
  const database = new DatabaseGate(
    `strategy-jobs:${workerId}`,
    options.log ?? {
      warn: (fields, message) => console.warn(`${tag} ${message}`, fields),
      info: (fields, message) => console.log(`${tag} ${message}`, fields),
    },
  );

  let stopping = false;
  let loop: Promise<void> | null = null;
  let current: AbortController | null = null;
  let wakeIdle: (() => void) | null = null;
  let nextKind = 0;

  const idle = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wakeIdle = null;
        resolve();
      }
      wakeIdle = done;
    });

  async function recoverStale(): Promise<void> {
    for (const kind of kinds) {
      try {
        const recovered = await STRATEGY_JOB_HANDLERS[kind].recoverStale(staleAfterMs);
        if (recovered > 0) console.warn(`${tag} Requeued ${recovered} stale ${kind} job(s)`);
      } catch (err) {
        // A dead database fails the whole poll (reported once by the gate).
        if (isConnectionError(err)) throw err;
        console.error(`${tag} Stale ${kind} recovery failed:`, err);
      }
    }
  }

  async function claimNext(): Promise<{ kind: backtests.StrategyJobKind; job: ClaimedJob } | null> {
    for (let i = 0; i < kinds.length; i++) {
      const index = (nextKind + i) % kinds.length;
      const job = await STRATEGY_JOB_HANDLERS[kinds[index]].claim(workerId);
      if (job) {
        nextKind = (index + 1) % kinds.length;
        return { kind: kinds[index], job };
      }
    }
    return null;
  }

  async function execute(kind: backtests.StrategyJobKind, job: ClaimedJob): Promise<void> {
    const handler = STRATEGY_JOB_HANDLERS[kind];
    const controller = new AbortController();
    current = controller;
    const budget = setTimeout(() => controller.abort(new JobInterruptedError("TIME_BUDGET")), jobTimeBudgetMs);
    const heartbeat = setInterval(() => {
      handler.heartbeat(job.id).catch((err) => console.error(`${tag} Heartbeat for ${kind} ${job.id} failed:`, err));
    }, heartbeatIntervalMs);
    const startedAt = Date.now();
    console.log(`${tag} Running ${kind} ${job.id}`);
    try {
      await job.run(createJobContext(controller.signal));
    } catch (err) {
      if (err instanceof JobInterruptedError && err.reason === "SHUTDOWN") {
        await handler.release(job.id, workerId);
        console.warn(`${tag} Requeued ${kind} ${job.id}: runner stopping`);
      } else if (err instanceof JobInterruptedError && err.reason === "TIME_BUDGET") {
        const minutes = Math.round(jobTimeBudgetMs / 60_000);
        await handler.fail(job.id, "TIME_BUDGET_EXCEEDED", `Stopped after exceeding the ${minutes}-minute time budget for one job.`);
        console.warn(`${tag} Failed ${kind} ${job.id}: time budget exceeded`);
      } else if (err instanceof JobInterruptedError) {
        console.warn(`${tag} Dropped ${kind} ${job.id}: another worker took the job over`);
      } else {
        // Job functions record their own failures; this is a failure while doing so.
        console.error(`${tag} ${kind} ${job.id} crashed:`, err);
        await handler.fail(job.id, "INTERNAL_ERROR", "The job failed unexpectedly.");
      }
    } finally {
      clearTimeout(budget);
      clearInterval(heartbeat);
      current = null;
      console.log(`${tag} Finished ${kind} ${job.id} in ${Date.now() - startedAt}ms`);
    }
  }

  async function runLoop(): Promise<void> {
    let nextRecoveryAt = 0;
    while (!stopping) {
      // While the database circuit is open every claim would wait out the connect timeout and log
      // an error; stay idle until the health probe or a guarded read closes it.
      if (!databaseAvailable()) {
        await idle(pollIntervalMs);
        continue;
      }
      try {
        const claimed = await database.run(async () => {
          if (Date.now() >= nextRecoveryAt) {
            await recoverStale();
            nextRecoveryAt = Date.now() + recoveryIntervalMs;
          }
          return stopping ? null : await claimNext();
        });
        if (stopping) break;
        if (claimed) await execute(claimed.kind, claimed.job);
        // `undefined`: the circuit is open or the database just failed to connect.
        else await idle(pollIntervalMs);
      } catch (err) {
        console.error(`${tag} Runner loop error:`, err);
        recordDatabaseFailure(err);
        if (!stopping) await idle(pollIntervalMs);
      }
    }
  }

  return {
    workerId,
    start() {
      if (loop) return;
      stopping = false;
      console.log(`${tag} Started (${kinds.join(", ")})`);
      loop = runLoop().finally(() => {
        loop = null;
        console.log(`${tag} Stopped`);
      });
    },
    async stop() {
      stopping = true;
      current?.abort(new JobInterruptedError("SHUTDOWN"));
      wakeIdle?.();
      await loop;
    },
  };
}
