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
import { strategyDeploymentsRouter, createStrategyDeploymentsRouter } from "../../api/trpc/routers/strategy-deployments";
import { getSqlClient } from "../../data/drizzle/client";

const DAY_MS = 86_400_000;
const FIRST_BAR_MS = Date.parse("2026-06-01T00:00:00Z");

function dailyBars(symbol: string, closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    symbol, tf: "1d", ts: new Date(FIRST_BAR_MS + i * DAY_MS).toISOString(),
    open: close, high: close, low: close, close, volume: 1000, source: "test",
  }));
}

/** One minute after bar i closed: fresh data. */
const afterBarClose = (i: number) => () => new Date(FIRST_BAR_MS + (i + 1) * DAY_MS + 60_000);

function closeRule(operator: string, value: number) {
  return {
    kind: "GROUP", id: `g-${operator}-${value}`, combinator: "AND",
    children: [{
      kind: "CONDITION", id: `c-${operator}-${value}`, operator,
      left: { kind: "PRICE", field: "CLOSE" },
      right: { kind: "CONSTANT", value },
    }],
  };
}

/** Live NSE quotes per symbol (a symbol without a price has no quote) shared by the evaluator and the paper service. */
function paperFixture() {
  const prices: Record<string, number> = {};
  const quoteLoader = async (exchange: "NSE" | "BSE", symbol: string) => prices[symbol] === undefined ? null : ({
    exchange, symbol, price: prices[symbol], volume: 100, ts: new Date().toISOString(), source: "angelone", quality: "live",
  });
  const paperService = createPaperTradingService({
    database: getDb(),
    marketPhase: () => "OPEN",
    quoteLoader,
    symbolExists: async () => true,
  });
  return { prices, quoteLoader, paperService };
}

async function seedStrategyUser(
  user: string,
  versions: Array<{ id: string; definition: unknown }>,
  deployments: Array<{ id: string; versionId: string; mode: string; universe: string; riskLimits: unknown }>,
) {
  const sql = getSqlClient();
  const strategyId = crypto.randomUUID();
  await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`seed-${user}@example.com`})`;
  await sql`
    INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
    VALUES (${strategyId}, ${user}, 'Seeded Strat', '{"name":"Seeded"}')
  `;
  for (const [index, version] of versions.entries()) {
    await sql`
      INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES (${version.id}, ${strategyId}, ${user}, ${index + 1}, ${JSON.stringify(version.definition)}::jsonb, ${`hash-${version.id}`}, '3.0.0', '1.0.0')
    `;
  }
  for (const deployment of deployments) {
    await sql`
      INSERT INTO public.strategy_deployments (id, user_id, strategy_version_id, mode, universe, timeframe, status, risk_limits)
      VALUES (${deployment.id}, ${user}, ${deployment.versionId}, ${deployment.mode}, ${deployment.universe}, '1d', 'ACTIVE',
              ${JSON.stringify(deployment.riskLimits)}::jsonb)
    `;
  }
  await sql`INSERT INTO public.paper_accounts (user_id, cash_balance, initial_cash) VALUES (${user}, 100000, 100000)`;
}

async function removeUser(user: string) {
  // Paper fills and ledger entries are append-only outside an explicit history-mutation scope.
  await getSqlClient().begin(async (tx) => {
    await tx`SELECT set_config('maet.allow_history_mutation', 'true', true)`;
    await tx`DELETE FROM public.users WHERE id = ${user}`;
    await tx`DELETE FROM auth.users WHERE id = ${user}`;
  });
}

async function withAutomation<T>(run: () => Promise<T>): Promise<T> {
  const automation = process.env.GLOBAL_PAPER_AUTOMATION_ENABLED;
  process.env.GLOBAL_PAPER_AUTOMATION_ENABLED = "true";
  try {
    return await run();
  } finally {
    if (automation === undefined) delete process.env.GLOBAL_PAPER_AUTOMATION_ENABLED;
    else process.env.GLOBAL_PAPER_AUTOMATION_ENABLED = automation;
  }
}

describe("Strategy Deployments Test Suite", () => {
  it("1. Generates a deterministic per-bar claim fingerprint", () => {
    const fp1 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z");
    const fp2 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-01T00:00:00Z");
    const fp3 = computeSignalFingerprint("dep-1", "ver-1", "RELIANCE", "1d", "2026-06-02T00:00:00Z");

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
    const { prices, quoteLoader, paperService } = paperFixture();
    const context = (id: string, versionId: string): DeploymentEvaluationContext => ({
      id, userId: user, strategyVersionId: versionId, mode: "AUTO_PAPER", universe: "TCS", timeframe: "1d",
      status: "ACTIVE", riskLimits: { maximumOpenPositions: 1, maximumDailyLossPercent: 5 },
      userKillSwitch: false, deploymentKillSwitch: false,
    });
    const evaluate = (deployment: DeploymentEvaluationContext, i: number) => {
      prices.TCS = closes[i];
      return evaluateDeploymentForBar(deployment, bars[i], bars.slice(0, i + 1), {
        paperService,
        quoteLoader,
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
  it("7. DB integration: confirming a SHORT_ONLY MANUAL_CONFIRM entry enforces entry limits and opens a SHORT", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping MANUAL_CONFIRM test: TEST_DATABASE_URL not set");
      return;
    }
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const deploymentId = crypto.randomUUID();
    const rule = (operator: string) => ({
      kind: "GROUP", id: `g-${operator}`, combinator: "AND",
      children: [{
        kind: "CONDITION", id: `c-${operator}`, operator,
        left: { kind: "PRICE", field: "CLOSE" },
        right: { kind: "CONSTANT", value: 100 },
      }],
    });
    const strategy = {
      name: "manual-short",
      direction: "SHORT_ONLY",
      entry: rule("GREATER_THAN"),
      exit: rule("LESS_THAN"),
      risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 10, maximumOpenPositions: 1, allowPyramiding: false },
    };
    const riskLimits = { maximumOpenPositions: 1, maximumDailyLossPercent: 5 };
    const closes = [90, 110, 115, 120];
    const dayMs = 86_400_000;
    const firstBarMs = Date.parse("2026-06-01T00:00:00Z");
    const bars: Candle[] = closes.map((close, i) => ({
      symbol: "TCS", tf: "1d", ts: new Date(firstBarMs + i * dayMs).toISOString(),
      open: close, high: close, low: close, close, volume: 1000, source: "test",
    }));
    const { prices, quoteLoader, paperService } = paperFixture();
    // RELIANCE trades at its entry price: no unrealised P&L to trip the loss limits.
    prices.RELIANCE = 1500;
    const deployment: DeploymentEvaluationContext = {
      id: deploymentId, userId: user, strategyVersionId: versionId, mode: "MANUAL_CONFIRM", universe: "TCS",
      timeframe: "1d", status: "ACTIVE", riskLimits, userKillSwitch: false, deploymentKillSwitch: false,
    };
    const propose = async (i: number) => {
      prices.TCS = closes[i];
      const { decision } = await evaluateDeploymentForBar(deployment, bars[i], bars.slice(0, i + 1), {
        quoteLoader,
        now: () => new Date(firstBarMs + (i + 1) * dayMs + 60_000),
      });
      return decision;
    };
    const caller = createStrategyDeploymentsRouter({ paperService, quoteLoader })
      .createCaller({ userId: user, email: "manual@example.com", role: "user" });
    const confirm = async (decisionId: string) => {
      try {
        await caller.confirmProposal({ decisionId });
        return "ok";
      } catch (error) {
        return error instanceof TRPCError ? error.code : String(error);
      }
    };

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${user}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${`manual-${user}@example.com`})`;
      await sql`
        INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES (${strategyId}, ${user}, 'Manual Strat', '{"name":"Manual"}')
      `;
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${versionId}, ${strategyId}, ${user}, 1, ${JSON.stringify(strategy)}::jsonb, 'hash_manual_short', '3.0.0', '1.0.0')
      `;
      await sql`
        INSERT INTO public.strategy_deployments (id, user_id, strategy_version_id, mode, universe, timeframe, status, risk_limits)
        VALUES (${deploymentId}, ${user}, ${versionId}, 'MANUAL_CONFIRM', 'TCS', '1d', 'ACTIVE', ${JSON.stringify(riskLimits)}::jsonb)
      `;
      await sql`INSERT INTO public.paper_accounts (user_id, cash_balance, initial_cash) VALUES (${user}, 100000, 100000)`;
      // An open RELIANCE position already uses the deployment's single position slot.
      await sql`
        INSERT INTO public.paper_positions (user_id, symbol, average_entry_price, total_shares)
        VALUES (${user}, 'RELIANCE', 1500, 10)
      `;

      // The proposal is sized and directed like AUTO_PAPER: a SHORT_ONLY entry sells 10% of equity.
      const blocked = await propose(2);
      expect(blocked?.decision).toBe("PROPOSED");
      expect(blocked?.proposedOrder).toMatchObject({ signalType: "ENTRY", side: "SELL", quantity: 86 });

      // A SELL entry is still an entry: the open-positions limit refuses it.
      expect(await confirm(blocked.id)).toBe("PRECONDITION_FAILED");
      const [rejected] = await sql`SELECT decision, reason_code FROM public.strategy_execution_decisions WHERE id = ${blocked.id}`;
      expect([rejected.decision, rejected.reason_code]).toEqual(["REJECTED", "MAX_OPEN_POSITIONS_REACHED"]);
      const [noOrders] = await sql`SELECT count(*)::int AS n FROM public.paper_orders WHERE user_id = ${user}`;
      expect(noOrders.n).toBe(0);

      // With the slot free, the next bar's entry proposal confirms into a short position.
      await sql`DELETE FROM public.paper_positions WHERE user_id = ${user} AND symbol = 'RELIANCE'`;
      const allowed = await propose(3);
      expect(allowed?.proposedOrder).toMatchObject({ signalType: "ENTRY", side: "SELL", quantity: 83 }); // 10% of 100000 at 120
      expect(await confirm(allowed.id)).toBe("ok");
      const [position] = await sql`
        SELECT side, total_shares FROM public.paper_positions WHERE user_id = ${user} AND symbol = 'TCS'
      `;
      expect([position.side, position.total_shares]).toEqual(["SHORT", 83]);
    } finally {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('maet.allow_history_mutation', 'true', true)`;
        await tx`DELETE FROM public.users WHERE id = ${user}`;
        await tx`DELETE FROM auth.users WHERE id = ${user}`;
      });
    }
  }, 30_000);
  it("8. DB integration: other holdings' current losses count toward an entry's daily-loss limit", async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const [versionId, deploymentId] = [crypto.randomUUID(), crypto.randomUUID()];
    const { prices, quoteLoader, paperService } = paperFixture();
    const bars = dailyBars("TCS", [90, 110, 115, 120]);
    const deployment: DeploymentEvaluationContext = {
      id: deploymentId, userId: user, strategyVersionId: versionId, mode: "AUTO_PAPER", universe: "TCS", timeframe: "1d",
      status: "ACTIVE", riskLimits: { maximumOpenPositions: 5, maximumDailyLossPercent: 5 },
      userKillSwitch: false, deploymentKillSwitch: false,
    };
    const evaluate = (i: number) => {
      prices.TCS = bars[i].close;
      return evaluateDeploymentForBar(deployment, bars[i], bars.slice(0, i + 1), { paperService, quoteLoader, now: afterBarClose(i) });
    };

    try {
      await seedStrategyUser(
        user,
        [{ id: versionId, definition: { name: "loss", entry: closeRule("GREATER_THAN", 100), exit: closeRule("LESS_THAN", 100) } }],
        [{ id: deploymentId, versionId, mode: "AUTO_PAPER", universe: "TCS", riskLimits: deployment.riskLimits }],
      );
      // INFY was last filled at 1000 (its stored mark), so only a current quote shows its loss.
      await sql`
        INSERT INTO public.paper_positions (user_id, symbol, average_entry_price, total_shares, last_quote_price, unrealized_pnl)
        VALUES (${user}, 'INFY', 1000, 100, 1000, 0)
      `;

      await withAutomation(async () => {
        // INFY now trades at 900: a ₹10,000 (10%) loss today blocks the TCS entry.
        prices.INFY = 900;
        const marked = await evaluate(2);
        expect([marked.decision?.decision, marked.decision?.reasonCode]).toEqual(["REJECTED", "DAILY_LOSS_LIMIT_REACHED"]);

        // Without a current quote the stored loss still counts.
        delete prices.INFY;
        await sql`UPDATE public.paper_positions SET unrealized_pnl = -6000 WHERE user_id = ${user} AND symbol = 'INFY'`;
        const stored = await evaluate(3);
        expect([stored.decision?.decision, stored.decision?.reasonCode]).toEqual(["REJECTED", "DAILY_LOSS_LIMIT_REACHED"]);
      });
      const [orders] = await sql`SELECT count(*)::int AS n FROM public.paper_orders WHERE user_id = ${user}`;
      expect(orders.n).toBe(0);
    } finally {
      await removeUser(user);
    }
  }, 30_000);

  it("9. DB integration: entries are re-sized against the executable quote in AUTO_PAPER and on MANUAL_CONFIRM", async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const [autoId, manualId] = [crypto.randomUUID(), crypto.randomUUID()];
    const { prices, quoteLoader, paperService } = paperFixture();
    const riskLimits = { maximumOpenPositions: 5, maximumDailyLossPercent: 5, maximumPositionCapital: 10_000 };
    const context = (id: string, mode: "AUTO_PAPER" | "MANUAL_CONFIRM", universe: string): DeploymentEvaluationContext => ({
      id, userId: user, strategyVersionId: versionId, mode, universe, timeframe: "1d", status: "ACTIVE", riskLimits,
      userKillSwitch: false, deploymentKillSwitch: false,
    });
    // Both signals size on a 500 close: 10% of ₹100,000 is 20 shares, exactly the ₹10,000 cap.
    const evaluate = (deployment: DeploymentEvaluationContext) => {
      const bars = dailyBars(deployment.universe, [90, 500, 500]);
      return evaluateDeploymentForBar(deployment, bars[2], bars, { paperService, quoteLoader, now: afterBarClose(2) });
    };
    const caller = createStrategyDeploymentsRouter({ paperService, quoteLoader })
      .createCaller({ userId: user, email: "resize@example.com", role: "user" });

    try {
      await seedStrategyUser(
        user,
        [{
          id: versionId,
          definition: {
            name: "resize", entry: closeRule("GREATER_THAN", 100), exit: closeRule("LESS_THAN", 100),
            risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 10, maximumOpenPositions: 5, allowPyramiding: false },
          },
        }],
        [
          { id: autoId, versionId, mode: "AUTO_PAPER", universe: "TCS", riskLimits },
          { id: manualId, versionId, mode: "MANUAL_CONFIRM", universe: "WIPRO", riskLimits },
        ],
      );

      // A proposal keeps its 500-close size until it is confirmed at the then-current quote.
      prices.WIPRO = 500;
      const proposal = (await evaluate(context(manualId, "MANUAL_CONFIRM", "WIPRO"))).decision;
      expect(proposal?.proposedOrder).toMatchObject({ signalType: "ENTRY", side: "BUY", quantity: 20 });

      // The live quote is 600, not 500: 20 shares would fill ₹12,006 against a ₹10,000 cap.
      prices.TCS = 600;
      const auto = await withAutomation(() => evaluate(context(autoId, "AUTO_PAPER", "TCS")));
      expect(auto.decision?.decision).toBe("EXECUTED");
      expect(auto.decision?.proposedOrder).toMatchObject({ plannedQuantity: 20, quantity: 16 });

      prices.WIPRO = 600;
      await caller.confirmProposal({ decisionId: proposal.id });

      const fills = await sql`
        SELECT o.symbol, o.qty, f.fill_price FROM public.paper_orders o JOIN public.paper_fills f ON f.order_id = o.id
        WHERE o.user_id = ${user} ORDER BY o.symbol
      `;
      expect(fills.map((f) => [f.symbol, f.qty])).toEqual([["TCS", 16], ["WIPRO", 16]]);
      for (const fill of fills) expect(fill.qty * Number(fill.fill_price)).toBeLessThanOrEqual(10_000);
    } finally {
      await removeUser(user);
    }
  }, 30_000);

  it("10. DB integration: re-polling a bar after its entry filled never trades an overlapping exit", async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    const sql = getSqlClient();
    const user = crypto.randomUUID();
    const [versionId, deploymentId] = [crypto.randomUUID(), crypto.randomUUID()];
    const { prices, quoteLoader, paperService } = paperFixture();
    const bars = dailyBars("TCS", [90, 110, 115]);
    const deployment: DeploymentEvaluationContext = {
      id: deploymentId, userId: user, strategyVersionId: versionId, mode: "AUTO_PAPER", universe: "TCS", timeframe: "1d",
      status: "ACTIVE", riskLimits: { maximumOpenPositions: 1, maximumDailyLossPercent: 5 },
      userKillSwitch: false, deploymentKillSwitch: false,
    };
    prices.TCS = 115;

    try {
      // Every close above 100 also satisfies the exit rule (close above 50).
      await seedStrategyUser(
        user,
        [{ id: versionId, definition: { name: "overlap", entry: closeRule("GREATER_THAN", 100), exit: closeRule("GREATER_THAN", 50) } }],
        [{ id: deploymentId, versionId, mode: "AUTO_PAPER", universe: "TCS", riskLimits: deployment.riskLimits }],
      );
      await withAutomation(async () => {
        const poll = () => evaluateDeploymentForBar(deployment, bars[2], bars, { paperService, quoteLoader, now: afterBarClose(2) });
        const first = await poll();
        expect(first.decision?.decision).toBe("EXECUTED");
        // Now positioned, the exit rule matches the same bar; the bar is already claimed.
        const again = await poll();
        expect(again.decision).toBeNull();
        expect(again.signalEvent?.id).toBe(first.signalEvent?.id);
      });
      const orders = await sql`SELECT side FROM public.paper_orders WHERE user_id = ${user}`;
      expect(orders.map((o) => o.side)).toEqual(["BUY"]);
    } finally {
      await removeUser(user);
    }
  }, 30_000);
});
