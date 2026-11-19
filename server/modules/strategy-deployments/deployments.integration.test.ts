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
  evaluateDeploymentForBar,
  type DeploymentEvaluationContext,
} from "../../workers/strategy-evaluator";
import { createPaperTradingService } from "../paper-trading/service";
import { getDb } from "../../data/drizzle/client";
import type { Candle } from "@shared/types";
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
    const deployment = { status: "ACTIVE", riskLimits: {}, userKillSwitch: false, deploymentKillSwitch: true };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "RELIANCE" }, 50000, 1, 1000);

    expect(res.passed).toBeFalse();
    expect(res.rejectReason).toBe("KILL_SWITCH_ACTIVE");
  });

  it("3. Risk Gate blocks signal when max open positions reached", () => {
    const deployment = { status: "ACTIVE", riskLimits: { maximumOpenPositions: 2 }, userKillSwitch: false, deploymentKillSwitch: false };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "TCS" }, 50000, 2, 1000);

    expect(res.passed).toBeFalse();
    expect(res.rejectReason).toBe("MAX_OPEN_POSITIONS_REACHED");
  });

  it("4. Risk Gate passes when all conditions are satisfied", () => {
    const deployment = { status: "ACTIVE", riskLimits: { maximumOpenPositions: 5 }, userKillSwitch: false, deploymentKillSwitch: false };
    const res = evaluateRiskGate(deployment, { type: "ENTRY", symbol: "INFY" }, 50000, 1, 1000);

    expect(res.passed).toBeTrue();
  });

  it("4b. Data freshness is measured from the bar close, so a just-closed daily bar is not stale", () => {
    const deployment = { status: "ACTIVE", riskLimits: { maximumOpenPositions: 5 }, userKillSwitch: false, deploymentKillSwitch: false };
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
  it("6. DB integration: an AUTO_PAPER deployment trades a sized position once across several bars", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping AUTO_PAPER evaluation test: TEST_DATABASE_URL not set");
      return;
    }
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    const [longVersion, shortVersion] = [crypto.randomUUID(), crypto.randomUUID()];
    const [longDeployment, shortDeployment] = [crypto.randomUUID(), crypto.randomUUID()];
    const closeAbove100 = (operator: string) => ({
      kind: "GROUP", id: `g-${operator}`, combinator: "AND",
      children: [{
        kind: "CONDITION", id: `c-${operator}`, operator,
        left: { kind: "PRICE", field: "CLOSE" },
        right: { kind: "CONSTANT", value: 100 },
      }],
    });
    const strategy = (direction: string) => ({
      name: "auto-paper",
      direction,
      entry: closeAbove100("GREATER_THAN"),
      exit: closeAbove100("LESS_THAN"),
      risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 10, maximumOpenPositions: 1, allowPyramiding: false },
    });

    // Signals read bar i-1 and act on bar i: entry on bar 2, held through bars 3-4, exit on bar 5.
    const closes = [90, 110, 115, 120, 95, 96];
    const dayMs = 86_400_000;
    const firstBarMs = Date.parse("2026-06-01T00:00:00Z");
    const bars: Candle[] = closes.map((close, i) => ({
      symbol: "TCS", tf: "1d", ts: new Date(firstBarMs + i * dayMs).toISOString(),
      open: close, high: close, low: close, close, volume: 1000, source: "test",
    }));
    let quotePrice = 0;
    const paperService = createPaperTradingService({
      database: getDb(),
      marketPhase: () => "OPEN",
      quoteLoader: async (exchange: "NSE" | "BSE", symbol: string) => ({
        exchange, symbol, price: quotePrice, volume: 100, ts: new Date().toISOString(), source: "angelone", quality: "live",
      }),
      symbolExists: async () => true,
    });
    const context = (id: string, versionId: string): DeploymentEvaluationContext => ({
      id, userId: user, strategyVersionId: versionId, mode: "AUTO_PAPER", universe: "TCS", timeframe: "1d",
      status: "ACTIVE", riskLimits: { maximumOpenPositions: 1, maximumDailyLossPercent: 5 },
      userKillSwitch: false, deploymentKillSwitch: false,
    });
    const evaluate = (deployment: DeploymentEvaluationContext, i: number) => {
      quotePrice = closes[i];
      return evaluateDeploymentForBar(deployment, bars[i], bars.slice(0, i + 1), {
        paperService,
        // One minute after the bar closed: fresh data.
        now: () => new Date(firstBarMs + (i + 1) * dayMs + 60_000),
      });
    };
    const automation = process.env.GLOBAL_PAPER_AUTOMATION_ENABLED;
    process.env.GLOBAL_PAPER_AUTOMATION_ENABLED = "true";

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`auto-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'Auto Strat', '{"name":"Auto"}')
      `;
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${longVersion}, ${strategyId}, ${user}, 1, ${JSON.stringify(strategy("LONG_ONLY"))}::jsonb, 'hash_auto_long', '3.0.0', '1.0.0'),
               (${shortVersion}, ${strategyId}, ${user}, 2, ${JSON.stringify(strategy("SHORT_ONLY"))}::jsonb, 'hash_auto_short', '3.0.0', '1.0.0')
      `;
      await sql`
        INSERT INTO public.strategy_deployments (id, user_id, strategy_version_id, mode, universe, timeframe, status)
        VALUES (${longDeployment}, ${user}, ${longVersion}, 'AUTO_PAPER', 'TCS', '1d', 'ACTIVE'),
               (${shortDeployment}, ${user}, ${shortVersion}, 'AUTO_PAPER', 'TCS', '1d', 'ACTIVE')
      `;
      // The account was reset to generation 2; generation 1 left an open INFY position behind,
      // which must not count against maximumOpenPositions = 1.
      await sql`
        INSERT INTO public.paper_accounts (user_id, cash_balance, initial_cash, generation)
        VALUES (${user}, 100000, 100000, 2)
      `;
      await sql`
        INSERT INTO public.paper_positions (user_id, symbol, average_entry_price, total_shares, generation)
        VALUES (${user}, 'INFY', 1500, 10, 1)
      `;

      const long = context(longDeployment, longVersion);
      const results = [];
      for (let i = 1; i < bars.length; i++) results.push(await evaluate(long, i));
      const [bar1, bar2, bar3, bar4, bar5] = results;
      expect(bar1.signalEvent).toBeNull(); // bar 0 closed below 100
      expect(bar2.decision?.decision).toBe("EXECUTED");
      expect(bar2.decision?.proposedOrder).toMatchObject({ side: "BUY", quantity: 86 }); // 10% of 100000 at 115
      expect(bar3.signalEvent).toBeNull(); // entry still true, but already positioned: no pyramiding
      expect(bar4.signalEvent).toBeNull();
      expect(bar5.decision?.decision).toBe("EXECUTED");
      expect(bar5.decision?.proposedOrder).toMatchObject({ side: "SELL", quantity: 86 });

      // Re-evaluating bars, even once the position state has changed, never places another order.
      expect((await evaluate(long, 5)).decision).toBeNull();
      expect((await evaluate(long, 2)).decision).toBeNull();

      const orders = await sql`
        SELECT side, qty, status FROM public.paper_orders WHERE user_id = ${user} ORDER BY placed_at
      `;
      expect(orders.map((o) => [o.side, o.qty, o.status])).toEqual([["BUY", 86, "FILLED"], ["SELL", 86, "FILLED"]]);
      const [open] = await sql`
        SELECT count(*)::int AS n FROM public.paper_positions WHERE user_id = ${user} AND generation = 2 AND total_shares > 0
      `;
      expect(open.n).toBe(0);

      // A SHORT_ONLY strategy enters with a sell.
      const short = await evaluate(context(shortDeployment, shortVersion), 2);
      expect(short.decision?.decision).toBe("EXECUTED");
      // Sized from equity after the long round trip's fees, so slightly under 86.
      const shortQty = short.decision?.proposedOrder?.quantity;
      expect(short.decision?.proposedOrder?.side).toBe("SELL");
      expect(shortQty).toBeGreaterThan(80);
      const [shortPosition] = await sql`
        SELECT side, total_shares FROM public.paper_positions WHERE user_id = ${user} AND generation = 2 AND symbol = 'TCS'
      `;
      expect([shortPosition.side, shortPosition.total_shares]).toEqual(["SHORT", shortQty]);
    } finally {
      if (automation === undefined) delete process.env.GLOBAL_PAPER_AUTOMATION_ENABLED;
      else process.env.GLOBAL_PAPER_AUTOMATION_ENABLED = automation;
      // Paper fills and ledger entries are append-only outside an explicit history-mutation scope.
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('maet.allow_history_mutation', 'true', true)`;
        await tx`DELETE FROM public.users WHERE id = ${user}`;
        await tx`DELETE FROM auth.users WHERE id = ${user}`;
      });
    }
    // Around 14 serializable paper transactions: a busy local Postgres can exceed bun's 5s default.
  }, 30_000);
});
