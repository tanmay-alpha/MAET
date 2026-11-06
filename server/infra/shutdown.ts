/**
 * Graceful shutdown of the web process.
 *
 * Nitro's node-server runtime already traps SIGTERM/SIGINT (Render sends
 * SIGTERM on every deploy) and calls the app's `close` hook; the orchestrator
 * plugin runs this sequence from that hook. Background workers stop first so
 * nothing issues new queries or publishes, then Redis and the database pool
 * close. The whole sequence is bounded so a stuck step cannot hold the
 * process past Render's kill deadline.
 */

export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
}

export interface ShutdownLog {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ShutdownResult {
  completed: string[];
  failed: string[];
  timedOut: string[];
}

export interface ShutdownOptions {
  timeoutMs: number;
  log: ShutdownLog;
  /** Resolves when the shutdown budget is spent (default: a timer of `timeoutMs`). */
  deadline?: (timeoutMs: number) => Promise<void>;
}

/** Below Nitro's default 30s shutdown timeout, which in turn is within Render's grace period. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;

function timerDeadline(timeoutMs: number): { promise: Promise<void>; cancel: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, timeoutMs);
  timer.unref?.();
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Runs the steps in order. A failing step is logged and the next one still
 * runs. Once the deadline passes, the step in progress is abandoned and the
 * remaining steps are started without waiting for them, so connections are
 * still asked to close.
 */
export async function runShutdownSteps(steps: ShutdownStep[], options: ShutdownOptions): Promise<ShutdownResult> {
  const result: ShutdownResult = { completed: [], failed: [], timedOut: [] };
  const timer = options.deadline ? { promise: options.deadline(options.timeoutMs), cancel: () => {} } : timerDeadline(options.timeoutMs);
  let expired = false;
  const deadline = timer.promise.then(() => {
    expired = true;
    return "timeout" as const;
  });

  try {
    for (const step of steps) {
      const running = Promise.resolve()
        .then(step.run)
        .then(
          () => "done" as const,
          (error: unknown) => {
            options.log.error({ step: step.name, err: error instanceof Error ? error.message : String(error) }, "shutdown step failed");
            return "failed" as const;
          }
        );
      if (expired) {
        result.timedOut.push(step.name);
        continue;
      }
      const outcome = await Promise.race([running, deadline]);
      if (outcome === "done") result.completed.push(step.name);
      else if (outcome === "failed") result.failed.push(step.name);
      else {
        options.log.warn({ step: step.name, timeoutMs: options.timeoutMs }, "shutdown step exceeded the shutdown timeout");
        result.timedOut.push(step.name);
      }
    }
  } finally {
    timer.cancel();
  }
  return result;
}

/**
 * Stop hooks for in-process scheduled jobs started by other Nitro plugins
 * (e.g. the paper portfolio snapshot scheduler). They stop inside the
 * graceful shutdown, before the workers and connections, instead of on their
 * own `close` hooks, whose order relative to the database close is not fixed.
 */
const scheduledJobStops = new Map<string, () => Promise<void> | void>();

/** Registers a job's stop hook; returns a function that removes it. */
export function registerScheduledJob(name: string, stop: () => Promise<void> | void): () => void {
  scheduledJobStops.set(name, stop);
  return () => {
    if (scheduledJobStops.get(name) === stop) scheduledJobStops.delete(name);
  };
}

/** Stops every registered scheduled job concurrently; one failure does not skip the others. */
export async function stopScheduledJobs(): Promise<void> {
  const results = await Promise.allSettled([...scheduledJobStops.values()].map((stop) => Promise.resolve().then(stop)));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) throw failure.reason;
}

export interface GracefulShutdownDeps {
  /** Stops in-process scheduled jobs (awaiting any run in flight); defaults to `stopScheduledJobs`. */
  stopScheduledJobs?: () => Promise<void>;
  /** Stops the matcher, outbox publisher, feed subscriptions and job runners. */
  stopWorkers: () => Promise<void>;
  closeRedis: () => Promise<void>;
  closeDb: () => Promise<void>;
  timeoutMs?: number;
  log: ShutdownLog;
}

/** Returns an idempotent shutdown: concurrent and repeated calls share the first run. */
export function createGracefulShutdown(deps: GracefulShutdownDeps): () => Promise<ShutdownResult> {
  let running: Promise<ShutdownResult> | undefined;
  return () => {
    running ??= (async () => {
      deps.log.info({}, "graceful shutdown started");
      const result = await runShutdownSteps(
        [
          { name: "scheduled-jobs", run: deps.stopScheduledJobs ?? stopScheduledJobs },
          { name: "workers", run: deps.stopWorkers },
          { name: "redis", run: deps.closeRedis },
          { name: "database", run: deps.closeDb },
        ],
        { timeoutMs: deps.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS, log: deps.log }
      );
      deps.log.info({ ...result }, "graceful shutdown finished");
      return result;
    })();
    return running;
  };
}
