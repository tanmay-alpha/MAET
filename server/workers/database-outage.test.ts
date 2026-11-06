import { afterEach, describe, expect, it } from "bun:test";
import type { Tick } from "@shared/types";
import { bus } from "../infra/bus";
import {
  databaseBreakerState,
  recordDatabaseFailure,
  resetDatabaseBreakerForTests,
} from "../data/drizzle/availability";
import { AlertEvaluatorWorker } from "./alert-evaluator";
import { OrderMatcherWorker } from "./order-matcher";
import { PaperRiskMonitor } from "../modules/paper-trading/risk-monitor";
import type { PaperTradingLiquidationService } from "../modules/paper-trading/liquidation-service";
import { runEvaluatorCycle } from "./strategy-evaluator";
import { reconcileAlertSubscriptions, resetSubscriptionRefsForTesting } from "../orchestrator";

const TICKS = 50;

function connectionRefused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
}

function databaseDown(): void {
  recordDatabaseFailure(connectionRefused());
  expect(databaseBreakerState()).toBe("open");
}

/** Every log line any worker under test writes, whatever its level. */
function captureLogs() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = push;
  console.warn = push;
  console.error = push;
  console.info = push;
  return {
    lines,
    logger: { info: push, warn: push, error: push, debug() {} },
    restore() {
      Object.assign(console, originals);
    },
  };
}

function liveTick(symbol = "RELIANCE", price = 2500): Tick {
  return { exchange: "NSE", symbol, price, volume: 100, ts: new Date().toISOString(), source: "angelone", quality: "live" } as Tick;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let logs: ReturnType<typeof captureLogs> | undefined;

afterEach(() => {
  logs?.restore();
  logs = undefined;
  resetDatabaseBreakerForTests();
  resetSubscriptionRefsForTesting();
});

describe("background workers while the database circuit is open", () => {
  it("alert evaluator skips per-tick alert loads and logs the outage once", async () => {
    logs = captureLogs();
    let loads = 0;
    const worker = new AlertEvaluatorWorker({
      loadAlerts: async () => {
        loads++;
        throw connectionRefused();
      },
      log: logs.logger,
    });
    await worker.start();
    const startLines = logs.lines.length;
    databaseDown();

    for (let i = 0; i < TICKS; i++) {
      const quote = { symbol: "RELIANCE", price: 2500, quoteTimestamp: Date.now(), source: "angelone" };
      await expect(worker.processQuote(quote as never)).resolves.toEqual([]);
    }

    expect(loads).toBe(0);
    expect(logs.lines.length - startLines).toBeLessThanOrEqual(1);
  });

  it("alert evaluator trips the breaker on a connection error instead of rejecting every tick", async () => {
    logs = captureLogs();
    let loads = 0;
    const worker = new AlertEvaluatorWorker({
      loadAlerts: async () => {
        loads++;
        throw connectionRefused();
      },
      log: logs.logger,
    });
    await worker.start();
    const startLines = logs.lines.length;

    for (let i = 0; i < TICKS; i++) {
      const quote = { symbol: "RELIANCE", price: 2500, quoteTimestamp: Date.now(), source: "angelone" };
      await expect(worker.processQuote(quote as never)).resolves.toEqual([]);
    }

    expect(loads).toBe(1);
    expect(databaseBreakerState()).toBe("open");
    expect(logs.lines.length - startLines).toBeLessThanOrEqual(1);
  });

  it("order matcher makes no database calls for N ticks, then matches normally once the database is back", async () => {
    logs = captureLogs();
    const matched: string[] = [];
    let down = true;
    const worker = new OrderMatcherWorker({
      match: async (tick) => {
        if (down) throw connectionRefused();
        matched.push(tick.symbol);
        return [];
      },
      riskMonitor: { start() {}, stop() {}, updateQuote() {} },
      log: { info() {}, error: logs.logger.error },
    });
    worker.start();
    databaseDown();

    try {
      for (let i = 0; i < TICKS; i++) bus.emit("tick", liveTick());
      await flush();
      expect(matched).toEqual([]);
      expect(logs.lines.length).toBeLessThanOrEqual(1);

      // Database back (the health probe or a half-open trial closed the breaker):
      // the resting order is still there and the next tick matches it.
      down = false;
      resetDatabaseBreakerForTests();
      bus.emit("tick", liveTick("RELIANCE", 2490));
      await flush();
      await flush();
      expect(matched).toEqual(["RELIANCE"]);
    } finally {
      worker.stop();
    }
  });

  it("order matcher trips the breaker on the first connection error and stops calling the database", async () => {
    logs = captureLogs();
    let calls = 0;
    const worker = new OrderMatcherWorker({
      match: async () => {
        calls++;
        throw connectionRefused();
      },
      riskMonitor: { start() {}, stop() {}, updateQuote() {} },
      log: { info() {}, error: logs.logger.error },
    });
    worker.start();
    try {
      bus.emit("tick", liveTick());
      await flush();
      await flush();
      for (let i = 0; i < TICKS; i++) bus.emit("tick", liveTick());
      await flush();
      expect(calls).toBe(1);
      expect(databaseBreakerState()).toBe("open");
      expect(logs.lines.length).toBeLessThanOrEqual(1);
    } finally {
      worker.stop();
    }
  });

  it("risk monitor skips margin queries and logs the outage once", async () => {
    logs = captureLogs();
    let queries = 0;
    const liquidation = { liquidateAccount: async () => undefined } as unknown as PaperTradingLiquidationService;
    const monitor = new PaperRiskMonitor(liquidation, {
      findAccounts: async () => {
        queries++;
        throw connectionRefused();
      },
      logError: logs.logger.error,
    });
    monitor.updateQuote(liveTick());
    databaseDown();

    for (let i = 0; i < TICKS; i++) await monitor.monitorRisk();

    expect(queries).toBe(0);
    expect(logs.lines.length).toBeLessThanOrEqual(1);
  });

  it("risk monitor resumes margin checks once the database is back", async () => {
    let queries = 0;
    const liquidation = { liquidateAccount: async () => undefined } as unknown as PaperTradingLiquidationService;
    const monitor = new PaperRiskMonitor(liquidation, {
      findAccounts: async () => {
        queries++;
        return [];
      },
      logError() {},
    });
    monitor.updateQuote(liveTick());
    databaseDown();
    await monitor.monitorRisk();
    resetDatabaseBreakerForTests();
    await monitor.monitorRisk();
    expect(queries).toBe(1);
  });

  it("alert subscription reconciler does not query while the circuit is open", async () => {
    logs = captureLogs();
    let fetches = 0;
    const fetchSymbols = async () => {
      fetches++;
      throw connectionRefused();
    };
    databaseDown();

    for (let i = 0; i < TICKS; i++) await reconcileAlertSubscriptions(fetchSymbols);

    expect(fetches).toBe(0);
    expect(logs.lines.length).toBeLessThanOrEqual(1);
  });

  it("strategy evaluator skips its cycle while the circuit is open", async () => {
    logs = captureLogs();
    let passes = 0;
    databaseDown();

    for (let i = 0; i < TICKS; i++) {
      await runEvaluatorCycle({
        evaluate: async () => {
          passes++;
          throw connectionRefused();
        },
        logError: logs.logger.error,
      });
    }

    expect(passes).toBe(0);
    expect(logs.lines.length).toBeLessThanOrEqual(1);
  });
});
