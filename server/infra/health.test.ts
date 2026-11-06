import { afterAll, describe, expect, it } from "bun:test";
import { createApp, toWebHandler, type EventHandler } from "h3";
import healthRoute, { createHealthRoute } from "../api/health.get";
import { closeDb, resetDb } from "../data/drizzle/client";
import { DatabaseCircuitBreaker, resetDatabaseBreakerForTests } from "../data/drizzle/availability";
import { closeRedis } from "../data/redis/client";
import { createHealthChecker } from "./health";

function fetchHealth(handler: EventHandler) {
  const app = createApp();
  app.use("/api/health", handler);
  return toWebHandler(app)(new Request("http://localhost/api/health"));
}

const healthy = async () => "PONG";

afterAll(async () => {
  await closeRedis();
});

describe("GET /api/health", () => {
  it("actively probes the database and reports degraded with HTTP 200 when it is unreachable", async () => {
    const previousUrl = process.env.TEST_DATABASE_URL;
    // Port 1 refuses connections immediately, mimicking a paused/unreachable Postgres.
    process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:1/unreachable";
    resetDb();
    try {
      const res = await fetchHealth(healthRoute);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.checks.database).toBe(false);
    } finally {
      if (previousUrl === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = previousUrl;
      await closeDb();
      // The shared availability breaker followed the failed probe; reset it for other tests.
      resetDatabaseBreakerForTests();
    }
  });

  it("reports ok when every probe and pushed component is healthy", async () => {
    const checker = createHealthChecker({ probes: { database: healthy, redis: healthy } });
    const res = await fetchHealth(createHealthRoute(checker));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual({ database: true, redis: true, orchestrator: true, marketData: true });
  });

  it("treats a hanging probe as down once the timeout elapses", async () => {
    const checker = createHealthChecker({
      probes: { database: healthy, redis: () => new Promise(() => {}) },
      timeoutMs: 20,
    });
    const res = await fetchHealth(createHealthRoute(checker));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe(false);
    expect(body.checks.database).toBe(true);
  });

  it("reuses probe results within the cache TTL and re-probes after it", async () => {
    let clock = 0;
    let databaseCalls = 0;
    let databaseUp = false;
    const checker = createHealthChecker({
      probes: {
        database: async () => {
          databaseCalls += 1;
          if (!databaseUp) throw new Error("connect ECONNREFUSED");
        },
        redis: healthy,
      },
      cacheTtlMs: 10_000,
      now: () => clock,
    });

    const [first, concurrent] = await Promise.all([checker.check(), checker.check()]);
    expect(first.checks.database).toBe(false);
    expect(concurrent.checks.database).toBe(false);
    expect(databaseCalls).toBe(1);

    databaseUp = true;
    clock = 9_999;
    expect((await checker.check()).checks.database).toBe(false);
    expect(databaseCalls).toBe(1);

    clock = 10_000;
    const recovered = await checker.check();
    expect(recovered.checks.database).toBe(true);
    expect(recovered.status).toBe("ok");
    expect(databaseCalls).toBe(2);
  });

  it("degrades when a push-reported component reports failure", async () => {
    const checker = createHealthChecker({ probes: { database: healthy, redis: healthy } });
    checker.setComponentStatus("marketData", false);
    const body = await checker.check();
    expect(body.status).toBe("degraded");
    expect(body.checks.marketData).toBe(false);
  });

  it("opens and closes the database circuit from probe results and reports its state", async () => {
    let reachable = false;
    const breaker = new DatabaseCircuitBreaker();
    const checker = createHealthChecker({
      probes: {
        database: async () => {
          if (!reachable) throw new Error("connect ECONNREFUSED");
        },
        redis: healthy,
      },
      cacheTtlMs: 0,
      databaseCircuit: breaker,
    });

    const down = await checker.check();
    expect(breaker.state()).toBe("open");
    expect(down).toMatchObject({ status: "degraded", databaseCircuit: "open", checks: { database: false } });

    reachable = true;
    const up = await checker.check();
    expect(breaker.state()).toBe("closed");
    expect(up).toMatchObject({ status: "ok", databaseCircuit: "closed", checks: { database: true } });
  });

  it("reports the database as down while request failures hold the circuit open", async () => {
    const breaker = new DatabaseCircuitBreaker();
    const checker = createHealthChecker({ probes: { database: healthy, redis: healthy }, databaseCircuit: breaker });
    await checker.check();
    breaker.recordFailure(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));

    // Probe result is cached as healthy, but live traffic just saw the database vanish.
    const body = await checker.check();
    expect(body).toMatchObject({ status: "degraded", databaseCircuit: "open", checks: { database: false } });
  });

  it("does not open the database circuit on one probe timeout (busy pool)", async () => {
    const breaker = new DatabaseCircuitBreaker();
    const checker = createHealthChecker({
      probes: { database: () => new Promise(() => {}), redis: healthy },
      timeoutMs: 20,
      cacheTtlMs: 0,
      databaseCircuit: breaker,
    });

    const body = await checker.check();

    expect(body.checks.database).toBe(false);
    expect(breaker.state()).toBe("closed");
  });
});
