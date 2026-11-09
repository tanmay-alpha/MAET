/**
 * Strategy Deployments — Integration Test Suite.
 *
 * Verifies risk gate evaluation, deterministic signal fingerprinting,
 * completed candle signal detection, and mode routing.
 */

import { describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  evaluateRiskGate,
  computeSignalFingerprint,
  barDataFreshnessMs,
} from "../../workers/strategy-evaluator";
import { strategyDeploymentsRouter } from "../../api/trpc/routers/strategy-deployments";
import { getSqlClient } from "../../data/drizzle/client";

describe("Strategy Deployments Test Suite", () => {
  it("1. Generates deterministic signal fingerprint", () => {
    const fp1 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z", "ENTRY");
    const fp2 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z", "ENTRY");
    const fp3 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z", "EXIT");

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(fp1).toHaveLength(32);
  });

  it("2. Risk Gate blocks signal when kill switch is active", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: true, maxPositions: 5 };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "RELIANCE" }, 50000, 1, 1000);

    expect(res.passed).toBeFalse();
    expect(res.rejectReason).toBe("KILL_SWITCH_ACTIVE");
  });

  it("3. Risk Gate blocks signal when max open positions reached", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: false, maxPositions: 2 };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "TCS" }, 50000, 2, 1000);

    expect(res.passed).toBeFalse();
    expect(res.rejectReason).toBe("MAX_OPEN_POSITIONS_REACHED");
  });

  it("4. Risk Gate passes when all conditions are satisfied", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: false, maxPositions: 5 };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "INFY" }, 50000, 1, 1000);

    expect(res.passed).toBeTrue();
  });

  it("4b. Data freshness is measured from the bar close, so a just-closed daily bar is not stale", () => {
    const deployment = { status: "ACTIVE", killSwitchEnabled: false, maxPositions: 5 };
    const openMs = Date.parse("2026-06-01T00:00:00Z");
    const daily = { ts: "2026-06-01T00:00:00Z", tf: "1d" as const };
    const justClosed = barDataFreshnessMs(daily, openMs + 86_400_000 + 60_000);
    expect(justClosed).toBe(60_000);
    expect(evaluateRiskGate(deployment, { type: "ENTRY", symbol: "INFY" }, 50000, 1, justClosed).passed).toBeTrue();

    const quarterHour = { ts: "2026-06-01T04:00:00Z", tf: "15m" as const };
    const fresh = barDataFreshnessMs(quarterHour, Date.parse("2026-06-01T04:19:00Z"));
    expect(evaluateRiskGate(deployment, { type: "ENTRY", symbol: "INFY" }, 50000, 1, fresh).passed).toBeTrue();
    const stale = barDataFreshnessMs(quarterHour, Date.parse("2026-06-01T04:21:00Z"));
    expect(evaluateRiskGate(deployment, { type: "ENTRY", symbol: "INFY" }, 50000, 1, stale).rejectReason).toBe("STALE_MARKET_DATA");
  });

  it("5. DB integration: a stopped deployment can be neither paused nor re-activated", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping deployment lifecycle test: TEST_DATABASE_URL not set");
      return;
    }
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const [activeId, stoppedId] = [crypto.randomUUID(), crypto.randomUUID()];
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
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`deploy-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'Deploy Strat', '{"name":"Deploy"}')
      `;
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${versionId}, ${strategyId}, ${user}, 1, '{"name":"v1"}', 'hash_deploy', '3.0.0', '1.0.0')
      `;
      await sql`
        INSERT INTO public.strategy_deployments (id, user_id, strategy_version_id, mode, universe, timeframe, status)
        VALUES (${activeId}, ${user}, ${versionId}, 'ALERT_ONLY', 'TCS', '1d', 'ACTIVE'),
               (${stoppedId}, ${user}, ${versionId}, 'ALERT_ONLY', 'TCS', '1d', 'STOPPED')
      `;

      const caller = strategyDeploymentsRouter.createCaller({ userId: user, email: "deploy@example.com", role: "user" });
      expect(await settle(caller.pause({ deploymentId: stoppedId }))).toBe("PRECONDITION_FAILED");
      expect(await settle(caller.activate({ deploymentId: stoppedId }))).toBe("PRECONDITION_FAILED");
      expect(await settle(caller.pause({ deploymentId: crypto.randomUUID() }))).toBe("NOT_FOUND");

      expect(await settle(caller.pause({ deploymentId: activeId }))).toBe("ok");
      expect(await settle(caller.pause({ deploymentId: activeId }))).toBe("PRECONDITION_FAILED");
      expect(await settle(caller.activate({ deploymentId: activeId }))).toBe("ok");

      const rows = await sql`SELECT id, status FROM public.strategy_deployments WHERE user_id = ${user}`;
      expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({ [activeId]: "ACTIVE", [stoppedId]: "STOPPED" });
    } finally {
      await sql`DELETE FROM public.users WHERE id = ${user}`;
      await sql`DELETE FROM auth.users WHERE id = ${user}`;
    }
  });
});
