import { describe, expect, it } from "bun:test";
import { createGracefulShutdown, registerScheduledJob, runShutdownSteps, stopScheduledJobs, type ShutdownStep } from "./shutdown";

const silent = { info() {}, warn() {}, error() {} };

function recordingStep(name: string, calls: string[], run: () => Promise<void> | void = () => {}): ShutdownStep {
  return {
    name,
    run: async () => {
      calls.push(`${name}:start`);
      await run();
      calls.push(`${name}:end`);
    },
  };
}

describe("graceful shutdown", () => {
  it("stops scheduled jobs, then the workers, before closing Redis and the database pool", async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      stopScheduledJobs: async () => {
        calls.push("jobs:start");
        await Promise.resolve();
        calls.push("jobs:end");
      },
      stopWorkers: async () => {
        calls.push("workers:start");
        await Promise.resolve();
        calls.push("workers:end");
      },
      closeRedis: async () => {
        calls.push("redis");
      },
      closeDb: async () => {
        calls.push("database");
      },
      timeoutMs: 1_000,
      log: silent,
    });

    const result = await shutdown();

    expect(calls).toEqual(["jobs:start", "jobs:end", "workers:start", "workers:end", "redis", "database"]);
    expect(result).toEqual({ completed: ["scheduled-jobs", "workers", "redis", "database"], failed: [], timedOut: [] });
  });

  it("waits for registered scheduled jobs (the portfolio snapshot scheduler) before stopping workers", async () => {
    const calls: string[] = [];
    const inFlightRun = Promise.withResolvers<void>();
    const unregister = registerScheduledJob("test-scheduler", async () => {
      calls.push("scheduler:start");
      await inFlightRun.promise;
      calls.push("scheduler:end");
    });
    const shutdown = createGracefulShutdown({
      stopWorkers: async () => {
        calls.push("workers");
      },
      closeRedis: async () => {},
      closeDb: async () => {
        calls.push("database");
      },
      log: silent,
    });

    const done = shutdown();
    // The stop hook has started and is blocked on the in-flight run; workers must not have stopped.
    for (let i = 0; i < 20 && !calls.includes("scheduler:start"); i++) await Promise.resolve();
    expect(calls).toEqual(["scheduler:start"]);
    inFlightRun.resolve();
    await done;
    unregister();
    expect(calls).toEqual(["scheduler:start", "scheduler:end", "workers", "database"]);
  });

  it("stops every scheduled job even when one fails, then reports the failure", async () => {
    let stopped = false;
    const unregisterFailing = registerScheduledJob("test-failing", () => {
      throw new Error("boom");
    });
    const unregisterOther = registerScheduledJob("test-other", () => {
      stopped = true;
    });
    await expect(stopScheduledJobs()).rejects.toThrow("boom");
    unregisterFailing();
    unregisterOther();
    expect(stopped).toBe(true);
  });

  it("runs only once when the close hook fires twice", async () => {
    let stops = 0;
    const shutdown = createGracefulShutdown({
      stopWorkers: async () => {
        stops++;
      },
      closeRedis: async () => {},
      closeDb: async () => {},
      log: silent,
    });

    await Promise.all([shutdown(), shutdown()]);
    await shutdown();
    expect(stops).toBe(1);
  });

  it("keeps closing connections after a step fails", async () => {
    const calls: string[] = [];
    const result = await runShutdownSteps(
      [
        recordingStep("workers", calls, () => {
          throw new Error("matcher refused to stop");
        }),
        recordingStep("redis", calls),
        recordingStep("database", calls),
      ],
      { timeoutMs: 1_000, log: silent }
    );

    expect(calls).toEqual(["workers:start", "redis:start", "redis:end", "database:start", "database:end"]);
    expect(result.failed).toEqual(["workers"]);
    expect(result.completed).toEqual(["redis", "database"]);
  });

  it("bounds a hanging step by the shutdown deadline and still starts the later closes", async () => {
    const calls: string[] = [];
    const deadline = Promise.withResolvers<void>();
    const pending = runShutdownSteps(
      [
        recordingStep("workers", calls, () => new Promise<void>(() => {})),
        recordingStep("redis", calls),
        recordingStep("database", calls),
      ],
      { timeoutMs: 20_000, log: silent, deadline: () => deadline.promise }
    );

    await Promise.resolve();
    expect(calls).toEqual(["workers:start"]);
    deadline.resolve();
    const result = await pending;

    // Steps reached after the deadline are started (connections still get closed) but not awaited.
    expect(result.timedOut).toEqual(["workers", "redis", "database"]);
    expect(calls).toContain("redis:start");
    expect(calls).toContain("database:start");
  });
});
