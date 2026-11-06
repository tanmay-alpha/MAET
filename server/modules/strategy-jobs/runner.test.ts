import { afterEach, describe, expect, it } from "bun:test";
import { databaseBreakerState, resetDatabaseBreakerForTests } from "../../data/drizzle/availability";
import { createStrategyJobRunner, STRATEGY_JOB_HANDLERS } from "./runner";

const original = { ...STRATEGY_JOB_HANDLERS.backtest };

afterEach(() => {
  Object.assign(STRATEGY_JOB_HANDLERS.backtest, original);
  resetDatabaseBreakerForTests();
});

describe("strategy job runner and the database circuit", () => {
  it("does not query the queues while the database circuit is open, and resumes when it closes", async () => {
    const calls = { claim: 0, recoverStale: 0 };
    const firstClaim = Promise.withResolvers<void>();
    // Replaces the backtest queue calls with counters, so no database is touched.
    STRATEGY_JOB_HANDLERS.backtest.claim = async () => {
      calls.claim++;
      firstClaim.resolve();
      return null;
    };
    STRATEGY_JOB_HANDLERS.backtest.recoverStale = async () => {
      calls.recoverStale++;
      return 0;
    };

    let available = false;
    let checks = 0;
    const threeClosedChecks = Promise.withResolvers<void>();
    const runner = createStrategyJobRunner({
      kinds: ["backtest"],
      pollIntervalMs: 1,
      isDatabaseAvailable: () => {
        if (++checks === 3) threeClosedChecks.resolve();
        return available;
      },
    });

    runner.start();
    // Three loop iterations with the circuit open: none may reach the queues.
    await threeClosedChecks.promise;
    expect(calls).toEqual({ claim: 0, recoverStale: 0 });

    available = true;
    await firstClaim.promise;
    await runner.stop();
    expect(calls.claim).toBeGreaterThan(0);
    expect(calls.recoverStale).toBeGreaterThan(0);
  });

  it("logs a database outage once as a one-line warning, not on every failed probe", async () => {
    const warnings: string[] = [];
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    let claims = 0;
    const fiveProbes = Promise.withResolvers<void>();
    STRATEGY_JOB_HANDLERS.backtest.recoverStale = async () => 0;
    STRATEGY_JOB_HANDLERS.backtest.claim = async () => {
      if (++claims === 5) fiveProbes.resolve();
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    };
    const runner = createStrategyJobRunner({
      kinds: ["backtest"],
      pollIntervalMs: 1,
      // Every poll is a fresh trial (as after each cooldown) that hits a dead database.
      isDatabaseAvailable: () => {
        resetDatabaseBreakerForTests();
        return true;
      },
      log: {
        warn: (_fields, message) => warnings.push(message),
        info: () => {},
      },
    });
    try {
      runner.start();
      await fiveProbes.promise;
      await runner.stop();
    } finally {
      console.error = originalError;
    }
    expect(claims).toBeGreaterThanOrEqual(5);
    expect(databaseBreakerState()).toBe("open");
    expect(warnings).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
