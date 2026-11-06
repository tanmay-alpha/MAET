import { afterEach, describe, expect, it } from "bun:test";
import { createStrategyJobRunner, STRATEGY_JOB_HANDLERS } from "./runner";

const original = { ...STRATEGY_JOB_HANDLERS.backtest };

afterEach(() => {
  Object.assign(STRATEGY_JOB_HANDLERS.backtest, original);
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
});
