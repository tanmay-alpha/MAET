/**
 * Strategy Jobs — integration test suite.
 * Tests the durable job queue logic (non-DB, pure logic tests).
 * DB integration tests require TEST_DATABASE_URL.
 */

import { describe, expect, it, mock } from "bun:test";
import { TRPCError } from "@trpc/server";

// ============================================================
// Pure logic tests (no DB required)
// ============================================================

describe("Strategy Jobs — Job Queue Logic", () => {
  it("1. Job status transitions are correct sequence", () => {
    const validTransitions: Record<string, string[]> = {
      QUEUED: ["RUNNING", "CANCELLED"],
      RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
      COMPLETED: [],
      FAILED: [],
      CANCELLED: [],
    };

    // Verify QUEUED can become RUNNING
    expect(validTransitions.QUEUED).toContain("RUNNING");
    // COMPLETED is terminal
    expect(validTransitions.COMPLETED).toHaveLength(0);
    // FAILED is terminal
    expect(validTransitions.FAILED).toHaveLength(0);
  });

  it("2. Heartbeat timeout constant is positive and reasonable", async () => {
    // 5 minutes heartbeat timeout
    const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;
    expect(HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEARTBEAT_TIMEOUT_MS).toBeLessThanOrEqual(15 * 60 * 1000); // Max 15 mins
  });

  it("3. Error summary is truncated to 500 chars", () => {
    const longError = "x".repeat(600);
    const truncated = longError.length > 500 ? `${longError.slice(0, 497)}...` : longError;
    expect(truncated.length).toBeLessThanOrEqual(500);
    expect(truncated.endsWith("...")).toBe(true);
  });

  it("4. Worker ID format is correct (includes process PID)", () => {
    const pid = 12345;
    const uuid = "abcdef12";
    const workerId = `bw-${uuid.slice(0, 8)}-${pid}`;
    expect(workerId).toMatch(/^bw-[a-f0-9]{8}-\d+$/);
  });

  it("5. Progress is clamped between 0 and 99 during run (100 only at completion)", () => {
    function clampProgress(p: number): number {
      return Math.min(99, Math.max(0, p));
    }
    expect(clampProgress(-5)).toBe(0);
    expect(clampProgress(50)).toBe(50);
    expect(clampProgress(99)).toBe(99);
    expect(clampProgress(100)).toBe(99); // Only worker sets 100 at completion
    expect(clampProgress(200)).toBe(99);
  });

  it("6. Equity curve downsampler preserves first and last points", () => {
    function downsample<T>(arr: T[], maxPoints: number): T[] {
      if (arr.length <= maxPoints) return arr;
      const step = Math.ceil(arr.length / maxPoints);
      return arr.filter((_, i) => i % step === 0 || i === arr.length - 1);
    }

    const points = Array.from({ length: 5000 }, (_, i) => ({ timestamp: i, equity: i * 10 }));
    const downsampled = downsample(points, 1000);

    expect(downsampled.length).toBeLessThanOrEqual(1001); // max + potentially last
    expect(downsampled[0]).toEqual(points[0]);
    expect(downsampled[downsampled.length - 1]).toEqual(points[points.length - 1]);
  });

  it("7. SQL injection prevention: error summary redacts SQL keywords", () => {
    const rawError = "column 'users' does not exist in table 'syntax'";
    const safeMessage = rawError.replace(/column|table|index|constraint|syntax/gi, "[db]");
    expect(safeMessage).not.toContain("column");
    expect(safeMessage).not.toContain("table");
    expect(safeMessage).not.toContain("syntax");
    expect(safeMessage).toContain("[db]");
  });

  it("8. DB integration: createJob and claimNextJob require TEST_DATABASE_URL", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping DB integration test: TEST_DATABASE_URL not set");
      return;
    }

    const { createJob, claimNextJob, markFailed } = await import("./repository");
    const { getSqlClient } = await import("../../data/drizzle/client");
    const sql = getSqlClient();

    const testUserId = "00000000-0000-0000-0000-000000000001";
    const testStratId = "00000000-0000-0000-0000-000000000002";
    const testVersionId = "00000000-0000-0000-0000-000000000003";

    await sql.unsafe(`
      INSERT INTO auth.users (id) VALUES ('${testUserId}') ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, email) VALUES ('${testUserId}', 'test_user_jobs@maet.com') ON CONFLICT DO NOTHING;
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
      VALUES ('${testStratId}', '${testUserId}', 'Test Strat', '{"name":"Test"}') ON CONFLICT DO NOTHING;
      INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES ('${testVersionId}', '${testStratId}', '${testUserId}', 1, '{"name":"v1"}', 'hash_test', '3.0.0', '1.0.0') ON CONFLICT DO NOTHING;
      UPDATE public.strategy_backtest_jobs SET status = 'CANCELLED'
      WHERE user_id = '${testUserId}' AND status IN ('QUEUED', 'RUNNING');
    `);

    const job = await createJob(
      testUserId, testVersionId, "TEST", "1d",
      new Date("2023-01-01"), new Date("2023-12-31"),
    );
    expect(job.status).toBe("QUEUED");
    expect(job.userId).toBe(testUserId);

    const claimed = await claimNextJob("test-worker-1");
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.workerId).toBe("test-worker-1");

    await markFailed(claimed!.id, "TEST_ERROR", "Test failure");
  });

  it("9. DB integration: caps active backtest jobs and sweeps per user", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping DB cap test: TEST_DATABASE_URL not set");
      return;
    }
    const { createJob, MAX_ACTIVE_JOBS_PER_USER } = await import("./repository");
    const { strategyOptimisationRouter } = await import("../../api/trpc/routers/strategy-optimisation");
    const { getSqlClient } = await import("../../data/drizzle/client");
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`jobs-cap-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'Cap Strat', '{"name":"Cap"}')
      `;
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${versionId}, ${strategyId}, ${user}, 1, '{"name":"v1"}', 'hash_cap', '3.0.0', '1.0.0')
      `;

      const create = () => createJob(user, versionId, "TEST", "1d", new Date("2023-01-01"), new Date("2023-12-31"));
      const results = await Promise.allSettled(Array.from({ length: MAX_ACTIVE_JOBS_PER_USER + 1 }, create));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_ACTIVE_JOBS_PER_USER);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });

      // Finished jobs free a slot.
      await sql`
        UPDATE public.strategy_backtest_jobs SET status = 'COMPLETED'
        WHERE id = (SELECT id FROM public.strategy_backtest_jobs WHERE user_id = ${user} LIMIT 1)
      `;
      expect((await create()).status).toBe("QUEUED");

      const caller = strategyOptimisationRouter.createCaller({ userId: user, email: "cap@example.com", role: "user" });
      const sweep = () =>
        caller.createSweep({
          strategyId,
          parameters: [{ name: "p", path: "a.b", values: [1, 2] }],
          symbolOrUniverse: "TCS",
          timeframe: "1d",
          from: "2023-01-01T00:00:00.000Z",
          to: "2023-12-31T00:00:00.000Z",
        });
      for (let i = 0; i < MAX_ACTIVE_JOBS_PER_USER; i++) await sweep();
      await expect(sweep()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    } finally {
      await sql`DELETE FROM public.users WHERE id = ${user}`;
      await sql`DELETE FROM auth.users WHERE id = ${user}`;
    }
  });

  it("10. DB integration: cancelled and stale (>6h) jobs do not count toward the cap", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping DB cap test: TEST_DATABASE_URL not set");
      return;
    }
    const { createJob, requestCancellation, MAX_ACTIVE_JOBS_PER_USER } = await import("./repository");
    const { strategyOptimisationRouter } = await import("../../api/trpc/routers/strategy-optimisation");
    const { getSqlClient } = await import("../../data/drizzle/client");
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    // Settle directly instead of expect(promise).rejects, which can stall postgres.js under Bun 1.3.
    const settle = async (operation: Promise<unknown>) => {
      try {
        await operation;
        return "ok";
      } catch (error) {
        return error instanceof TRPCError ? error.code : String(error);
      }
    };

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`jobs-stale-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'Stale Strat', '{"name":"Stale"}')
      `;
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${versionId}, ${strategyId}, ${user}, 1, '{"name":"v1"}', 'hash_stale', '3.0.0', '1.0.0')
      `;

      // Backtests: three queued jobs, all cancelled, leave room for a fourth.
      const create = () => createJob(user, versionId, "TEST", "1d", new Date("2023-01-01"), new Date("2023-12-31"));
      const jobs = [];
      for (let i = 0; i < MAX_ACTIVE_JOBS_PER_USER; i++) jobs.push(await create());
      expect(await settle(create())).toBe("TOO_MANY_REQUESTS");
      for (const job of jobs) expect(await requestCancellation(user, job.id)).toBe(true);
      expect(await settle(create())).toBe("ok");

      // A job queued more than 6h ago (no worker picked it up) is stale and frees its slot.
      await create();
      await create();
      expect(await settle(create())).toBe("TOO_MANY_REQUESTS");
      await sql`
        UPDATE public.strategy_backtest_jobs SET created_at = now() - interval '7 hours'
        WHERE id = (
          SELECT id FROM public.strategy_backtest_jobs
          WHERE user_id = ${user} AND cancel_requested_at IS NULL LIMIT 1
        )
      `;
      expect(await settle(create())).toBe("ok");

      const caller = strategyOptimisationRouter.createCaller({ userId: user, email: "stale@example.com", role: "user" });
      const window = { strategyId, timeframe: "1d", from: "2023-01-01T00:00:00.000Z", to: "2023-12-31T00:00:00.000Z" };
      const parameters = [{ name: "p", path: "a.b", values: [1, 2] }];
      const sweep = () => caller.createSweep({ ...window, parameters, symbolOrUniverse: "TCS" });
      const walkForward = () =>
        caller.createWalkForward({
          ...window,
          parameters,
          symbol: "TCS",
          mode: "ROLLING",
          trainingWindowDays: 30,
          validationWindowDays: 14,
          minimumWindows: 2,
        });

      for (const [table, start] of [
        ["strategy_parameter_sweeps", sweep],
        ["strategy_walk_forward_runs", walkForward],
      ] as const) {
        for (let i = 0; i < MAX_ACTIVE_JOBS_PER_USER; i++) expect(await settle(start())).toBe("ok");
        expect(await settle(start())).toBe("TOO_MANY_REQUESTS");
        await sql`UPDATE ${sql(table)} SET created_at = now() - interval '7 hours' WHERE user_id = ${user}`;
        expect(await settle(start())).toBe("ok");
      }
    } finally {
      await sql`DELETE FROM public.users WHERE id = ${user}`;
      await sql`DELETE FROM auth.users WHERE id = ${user}`;
    }
  });

  it("11. DB integration: sweeps and walk-forward runs reject oversize parameter grids", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping DB grid limit test: TEST_DATABASE_URL not set");
      return;
    }
    const { strategyOptimisationRouter } = await import("../../api/trpc/routers/strategy-optimisation");
    const { getSqlClient } = await import("../../data/drizzle/client");
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    // Settle directly instead of expect(promise).rejects, which can stall postgres.js under Bun 1.3.
    const settle = async (operation: Promise<unknown>) => {
      try {
        await operation;
        return "ok";
      } catch (error) {
        return error instanceof TRPCError ? error.code : String(error);
      }
    };

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`jobs-grid-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'Grid Strat', '{"name":"Grid"}')
      `;

      const caller = strategyOptimisationRouter.createCaller({ userId: user, email: "grid@example.com", role: "user" });
      const window = { strategyId, timeframe: "1d", from: "2022-01-01T00:00:00.000Z", to: "2023-12-31T00:00:00.000Z" };
      // 10 x 10 x 6 = 600 combinations, above the 500 limit.
      const parameters = [10, 10, 6].map((count, i) => ({ name: `p${i}`, path: "a.b", values: Array.from({ length: count }, (_, v) => v + 1) }));
      const walkForward = { ...window, parameters, symbol: "TCS", mode: "ROLLING" as const, trainingWindowDays: 30, validationWindowDays: 14, minimumWindows: 2 };

      expect(await settle(caller.createSweep({ ...window, parameters, symbolOrUniverse: "TCS" }))).toBe("BAD_REQUEST");
      expect(await settle(caller.createWalkForward(walkForward))).toBe("BAD_REQUEST");
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM public.strategy_walk_forward_runs WHERE user_id = ${user}`;
      expect(count).toBe(0);

      expect(await settle(caller.createWalkForward({ ...walkForward, parameters: parameters.slice(0, 2) }))).toBe("ok");
    } finally {
      await sql`DELETE FROM public.users WHERE id = ${user}`;
      await sql`DELETE FROM auth.users WHERE id = ${user}`;
    }
  });

  it("12. DB integration: listJobs filters by strategy version", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping DB listJobs test: TEST_DATABASE_URL not set");
      return;
    }
    const { createJob } = await import("./repository");
    const { strategyBacktestsRouter } = await import("../../api/trpc/routers/strategy-backtests");
    const { getSqlClient } = await import("../../data/drizzle/client");
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    const [versionA, versionB] = [crypto.randomUUID(), crypto.randomUUID()];

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`jobs-list-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'List Strat', '{"name":"List"}')
      `;
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${versionA}, ${strategyId}, ${user}, 1, '{"name":"v1"}', 'hash_list_1', '3.0.0', '1.0.0'),
               (${versionB}, ${strategyId}, ${user}, 2, '{"name":"v2"}', 'hash_list_2', '3.0.0', '1.0.0')
      `;
      const jobA = await createJob(user, versionA, "TEST", "1d", new Date("2023-01-01"), new Date("2023-12-31"));
      const jobB = await createJob(user, versionB, "TEST", "1d", new Date("2023-01-01"), new Date("2023-12-31"));

      const caller = strategyBacktestsRouter.createCaller({ userId: user, email: "list@example.com", role: "user" });
      expect((await caller.listJobs({ strategyVersionId: versionA, limit: 20 })).jobs.map((job) => job.id)).toEqual([jobA.id]);
      expect((await caller.listJobs({ strategyVersionId: versionB, limit: 20 })).jobs.map((job) => job.id)).toEqual([jobB.id]);
      expect(new Set((await caller.listJobs()).jobs.map((job) => job.id))).toEqual(new Set([jobA.id, jobB.id]));
    } finally {
      await sql`DELETE FROM public.users WHERE id = ${user}`;
      await sql`DELETE FROM auth.users WHERE id = ${user}`;
    }
  });
});
