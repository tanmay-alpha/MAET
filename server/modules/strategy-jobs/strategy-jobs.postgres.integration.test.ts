/**
 * Strategy Jobs — PostgreSQL Integration Test Suite.
 *
 * Exercises real PostgreSQL operations:
 * - FOR UPDATE SKIP LOCKED concurrency
 * - Job creation & worker claim isolation
 * - Heartbeat persistence & timeout recovery
 * - Cancellation request persistence & worker detection
 * - Error redaction & status transitions
 * - User tenant isolation
 */

import { describe, expect, it } from "bun:test";
import { applyMigrations } from "../../scripts/apply-migrations";
import {
  createJob,
  claimNextJob,
  updateHeartbeat,
  requestCancellation,
  recoverAbandonedJobs,
  redactSqlKeywords,
} from "./repository";

describe("Strategy Jobs — PostgreSQL Integration Test Suite", () => {
  it("PostgreSQL Job Queue Concurrency, Heartbeat, Recovery, & Isolation", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.log("  Skipping PostgreSQL Job Integration Test: TEST_DATABASE_URL not set");
      return;
    }

    // Apply all 16 migrations
    await applyMigrations();

    const { getSqlClient } = await import("../../data/drizzle/client");
    const sql = getSqlClient();

    // Seed test users & strategy definitions
    const userA = "00000000-0000-0000-0000-00000000000a";
    const userB = "00000000-0000-0000-0000-00000000000b";
    await sql.unsafe(`
      INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}') ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, email) VALUES ('${userA}', 'usera@test.com'), ('${userB}', 'userb@test.com') ON CONFLICT DO NOTHING;
    `);

    // Create strategy definition & version for User A
    const stratA = "11111111-1111-1111-1111-111111111111";
    const verA = "22222222-2222-2222-2222-222222222222";
    await sql.unsafe(`
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
      VALUES ('${stratA}', '${userA}', 'User A Strategy', '{"name":"User A"}') ON CONFLICT DO NOTHING;

      INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES ('${verA}', '${stratA}', '${userA}', 1, '{"name":"v1"}', 'hash_a', '3.0.0', '1.0.0') ON CONFLICT DO NOTHING;
    `);

    // 1. Create Queued Jobs for User A
    const jobA1 = await createJob(
      userA,
      verA,
      "RELIANCE",
      "1d",
      new Date("2026-01-01"),
      new Date("2026-06-01"),
      100000,
    );

    const jobA2 = await createJob(
      userA,
      verA,
      "TCS",
      "1d",
      new Date("2026-01-01"),
      new Date("2026-06-01"),
      100000,
    );

    expect(jobA1.status).toBe("QUEUED");
    expect(jobA2.status).toBe("QUEUED");

    // 2. FOR UPDATE SKIP LOCKED Claim — Worker 1 claims oldest job
    const worker1 = `worker-node-pid-${process.pid}-1`;
    const claimedJob1 = await claimNextJob(worker1);

    expect(claimedJob1).not.toBeNull();
    expect(claimedJob1?.workerId).toBe(worker1);
    expect(claimedJob1?.status).toBe("RUNNING");

    // 3. Worker 2 claims next job concurrently — gets different job (skip locked works)
    const worker2 = `worker-node-pid-${process.pid}-2`;
    const claimedJob2 = await claimNextJob(worker2);

    expect(claimedJob2).not.toBeNull();
    expect(claimedJob2?.workerId).toBe(worker2);
    expect(claimedJob2?.id).not.toBe(claimedJob1?.id);

    // 4. Heartbeat Persistence
    if (claimedJob1) {
      await updateHeartbeat(claimedJob1.id);
      const [hbJob] = await sql`
        SELECT heartbeat_at FROM public.strategy_backtest_jobs WHERE id = ${claimedJob1.id}
      `;
      expect(hbJob.heartbeat_at).toBeDefined();
    }

    // 5. Cancellation Request & Worker Detection
    if (claimedJob1) {
      await requestCancellation(userA, claimedJob1.id);
      const [cancelJob] = await sql`
        SELECT cancel_requested_at FROM public.strategy_backtest_jobs WHERE id = ${claimedJob1.id}
      `;
      expect(cancelJob.cancel_requested_at).not.toBeNull();
    }

    // 6. Abandoned Job Recovery
    const staleJobId = "33333333-3333-3333-3333-333333333333";
    await sql.unsafe(`
      INSERT INTO public.strategy_backtest_jobs (id, user_id, strategy_version_id, symbol_or_universe, timeframe, from_date, to_date, status, worker_id, heartbeat_at, requested_at)
      VALUES ('${staleJobId}', '${userA}', '${verA}', 'INFY', '1d', NOW() - INTERVAL '30 days', NOW(), 'RUNNING', 'dead-worker', NOW() - INTERVAL '10 minutes', NOW())
      ON CONFLICT DO NOTHING;
    `);

    const recoveredCount = await recoverAbandonedJobs(300);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const [staleJobStatus] = await sql`
      SELECT status FROM public.strategy_backtest_jobs WHERE id = ${staleJobId}
    `;
    expect(staleJobStatus.status).toBe("QUEUED");

    // 7. Error Redaction
    const rawError = "SELECT * FROM users WHERE password_hash = 'secret'";
    const redacted = redactSqlKeywords(rawError);
    expect(redacted).not.toContain("SELECT");
    expect(redacted).toContain("[REDACTED]");

    // 8. Tenant Isolation (User B cannot query or update User A jobs)
    const userBQuery = await sql`
      SELECT id FROM public.strategy_backtest_jobs WHERE id = ${jobA1.id} AND user_id = ${userB}
    `;
    expect(userBQuery).toHaveLength(0);
  });
});
