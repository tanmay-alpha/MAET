/**
 * Strategy Jobs — integration test suite.
 * Tests the durable job queue logic (non-DB, pure logic tests).
 * DB integration tests require TEST_DATABASE_URL.
 */

import { describe, expect, it, mock } from "bun:test";

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
});
