import { describe, expect, it } from "bun:test";
import { createGracefulShutdown, runShutdownSteps, type ShutdownStep } from "./shutdown";

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
  it("stops the workers before closing Redis and the database pool", async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
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

    expect(calls).toEqual(["workers:start", "workers:end", "redis", "database"]);
    expect(result).toEqual({ completed: ["workers", "redis", "database"], failed: [], timedOut: [] });
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
