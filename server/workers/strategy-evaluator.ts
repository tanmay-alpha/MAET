/**
 * Strategy Deployment Evaluator Worker.
 *
 * Evaluates active strategy deployments against completed candles, enforces risk gates,
 * generates deterministic signal fingerprints, and routes execution through:
 * - ALERT_ONLY: emits signal event + notification
 * - MANUAL_CONFIRM: emits signal event + proposed execution decision for manual confirmation
 * - AUTO_PAPER: runs risk gate check and submits paper order via canonical paperTrading service
 */

import { db } from "../data/drizzle/client";
import {
  strategyDeployments,
  strategySignalEvents,
  strategyExecutionDecisions,
  strategyVersions,
  candles,
  paperAccounts,
  paperPositions,
  userNotifications,
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { evaluateRuleGroup } from "../domain/strategy/ast-evaluator";
import { IndicatorStateCache } from "../domain/strategy/indicator-state";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { createHash } from "crypto";

export interface DeploymentRiskLimits {
  maxPositions?: number;
  maxPositionCapital?: number;
  maxDailyLossPercent?: number;
  maxDrawdownPercent?: number;
  maxSectorExposurePercent?: number;
  maxSymbolExposurePercent?: number;
  cooldownMinutes?: number;
}

export interface DeploymentEvaluationContext {
  id: string;
  userId: string;
  strategyVersionId: string;
  mode: "ALERT_ONLY" | "MANUAL_CONFIRM" | "AUTO_PAPER";
  universe: string;
  timeframe: string;
  status: string;
  riskLimits: DeploymentRiskLimits;
  userKillSwitch: boolean;
  deploymentKillSwitch: boolean;
  lastEvaluatedAt?: Date | null;
  lastSignalAt?: Date | null;
}

export interface DeploymentRiskCheckResult {
  passed: boolean;
  rejectReason?: string;
}

export function evaluateRiskGate(
  deployment: DeploymentEvaluationContext | any,
  signal: { type: "ENTRY" | "EXIT"; symbol: string },
  accountCash: number,
  activePositionsCount: number,
  dataFreshnessMs: number,
): DeploymentRiskCheckResult {
  if (deployment.status !== "ACTIVE") {
    return { passed: false, rejectReason: "DEPLOYMENT_INACTIVE" };
  }

  const userKill = deployment.userKillSwitch ?? deployment.user_kill_switch ?? false;
  const depKill = deployment.deploymentKillSwitch ?? deployment.deployment_kill_switch ?? false;
  const legacyKill = deployment.killSwitchEnabled ?? deployment.kill_switch_enabled ?? false;

  if (userKill || depKill || legacyKill) {
    return { passed: false, rejectReason: "KILL_SWITCH_ACTIVE" };
  }

  if (dataFreshnessMs > 300_000) { // > 5 mins
    return { passed: false, rejectReason: "STALE_MARKET_DATA" };
  }

  const limits = deployment.riskLimits ?? {};
  const maxPositions = limits.maxPositions ?? deployment.maxPositions ?? deployment.max_positions ?? 5;
  if (signal.type === "ENTRY" && activePositionsCount >= maxPositions) {
    return { passed: false, rejectReason: "MAX_OPEN_POSITIONS_REACHED" };
  }

  const minCash = 1000;
  if (signal.type === "ENTRY" && accountCash < minCash) {
    return { passed: false, rejectReason: "INSUFFICIENT_ACCOUNT_CASH" };
  }

  return { passed: true };
}

export function computeSignalFingerprint(
  deploymentId: string,
  versionId: string,
  symbol: string,
  timeframe: string,
  barTs: string | number,
  signalType: string,
): string {
  const raw = `${deploymentId}::${versionId}::${symbol}::${timeframe}::${barTs}::${signalType}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function evaluateDeploymentForBar(
  deployment: DeploymentEvaluationContext,
  bar: Candle,
  allCandles: Candle[],
): Promise<{ signalEvent: any | null; decision: any | null }> {
  const deploymentId = deployment.id;
  const userId = deployment.userId;
  const versionId = deployment.strategyVersionId;
  const mode = deployment.mode;
  const symbol = bar.symbol;
  const timeframe = bar.tf;

  // 1. Fetch strategy version definition
  const [versionRow] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, versionId))
    .limit(1);

  if (!versionRow) return { signalEvent: null, decision: null };
  const definition = versionRow.definition as unknown as StrategyDefinition;

  // 2. Build indicator state cache and evaluate AST
  const cache = new IndicatorStateCache(allCandles);
  const barIndex = allCandles.findIndex((c) => c.ts === bar.ts);
  if (barIndex <= 0) return { signalEvent: null, decision: null };

  const entryGroup = definition.entry ?? (definition as any).entryRules;
  const exitGroup = definition.exit ?? (definition as any).exitRules;

  const entryEval = evaluateRuleGroup(entryGroup, cache, barIndex - 1);
  const exitEval = evaluateRuleGroup(exitGroup, cache, barIndex - 1);

  let signalType: "ENTRY" | "EXIT" | null = null;
  if (entryEval.matched) signalType = "ENTRY";
  else if (exitEval.matched) signalType = "EXIT";

  if (!signalType) return { signalEvent: null, decision: null };

  // 3. Generate deterministic fingerprint & enforce unique constraint
  const fingerprint = computeSignalFingerprint(
    deploymentId,
    versionId,
    symbol,
    timeframe,
    bar.ts,
    signalType,
  );

  // Check if signal event already exists
  const existingSignal = await db
    .select()
    .from(strategySignalEvents)
    .where(eq(strategySignalEvents.fingerprint, fingerprint))
    .limit(1);

  if (existingSignal.length > 0) return { signalEvent: existingSignal[0], decision: null };

  // Insert signal event
  const [signalEvent] = await db
    .insert(strategySignalEvents)
    .values({
      deploymentId,
      userId,
      strategyVersionId: versionId,
      symbol,
      timeframe,
      signalType,
      barCloseTimestamp: new Date(bar.ts),
      fingerprint,
      indicatorSnapshot: { triggerPrice: String(bar.close) },
    })
    .returning();

  // Update deployment lastSignalAt
  await db
    .update(strategyDeployments)
    .set({ lastSignalAt: new Date(), updatedAt: new Date() })
    .where(eq(strategyDeployments.id, deploymentId));

  let decision: any = null;

  // 4. Mode Routing
  if (mode === "ALERT_ONLY") {
    // Insert user notification + ALERT_ONLY decision
    const [dec] = await db
      .insert(strategyExecutionDecisions)
      .values({
        signalId: signalEvent.id,
        deploymentId,
        userId,
        decision: "ALERT_ONLY",
        reasonCode: "NOTIFICATION_EMITTED",
        reasonDetails: `Alert signal for ${symbol} @ ₹${bar.close}`,
      })
      .returning();
    decision = dec;

    await db.insert(userNotifications).values({
      userId,
      kind: "STRATEGY_SIGNAL",
      title: `Strategy Alert: ${symbol} ${signalType}`,
      body: `Deployment emitted ${signalType} signal for ${symbol} at ₹${bar.close} (${timeframe})`,
      symbol,
      payload: { deploymentId, signalId: signalEvent.id, price: bar.close },
    });
  } else if (mode === "MANUAL_CONFIRM") {
    // Insert proposed execution decision awaiting user confirmation with complete payload
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [dec] = await db
      .insert(strategyExecutionDecisions)
      .values({
        signalId: signalEvent.id,
        deploymentId,
        userId,
        decision: "PROPOSED",
        proposedOrder: {
          symbol,
          exchange: "NSE",
          side: signalType === "ENTRY" ? "BUY" : "SELL",
          type: "MARKET",
          quantity: 1,
          strategyVersionId: versionId,
          signalId: signalEvent.id,
          quoteMetadata: { price: bar.close, ts: bar.ts },
          expiresAt: expiresAt.toISOString(),
        },
      })
      .returning();
    decision = dec;
  } else if (mode === "AUTO_PAPER") {
    // Check global paper automation feature flag
    const globalAutomationEnabled = process.env.GLOBAL_PAPER_AUTOMATION_ENABLED === "true";
    if (!globalAutomationEnabled) {
      const [dec] = await db
        .insert(strategyExecutionDecisions)
        .values({
          signalId: signalEvent.id,
          deploymentId,
          userId,
          decision: "REJECTED",
          reasonCode: "GLOBAL_PAPER_AUTOMATION_DISABLED",
          reasonDetails: "Global paper automation is disabled by default for safety",
        })
        .returning();
      decision = dec;
      return { signalEvent, decision };
    }

    // Load actual server-side paper account & positions
    const [account] = await db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, userId))
      .limit(1);

    const positions = await db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.userId, userId), sql`${paperPositions.totalShares} > 0`));

    const cashBalance = account ? Number(account.cashBalance) : 0;
    const activePositionsCount = positions.length;
    const dataFreshnessMs = Date.now() - new Date(bar.ts).getTime();

    // Evaluate risk gate with real state
    const riskRes = evaluateRiskGate(deployment, { type: signalType, symbol }, cashBalance, activePositionsCount, dataFreshnessMs);

    if (riskRes.passed) {
      // Execute auto paper order via canonical paper trading service
      try {
        const { PaperTradingService } = await import("../modules/paper-trading/service");
        const service = new PaperTradingService();
        const orderRes = await service.placeOrder({
          userId,
          command: {
            symbol,
            side: signalType === "ENTRY" ? "BUY" : "SELL",
            type: "MARKET",
            qty: 1,
            idempotencyKey: `auto-${fingerprint}`,
          },
        });

        const [dec] = await db
          .insert(strategyExecutionDecisions)
          .values({
            signalId: signalEvent.id,
            deploymentId,
            userId,
            decision: "EXECUTED",
            paperOrderId: orderRes.order.id,
            proposedOrder: {
              symbol,
              exchange: "NSE",
              side: signalType === "ENTRY" ? "BUY" : "SELL",
              type: "MARKET",
              quantity: 1,
              strategyVersionId: versionId,
              signalId: signalEvent.id,
              quoteMetadata: { price: bar.close, ts: bar.ts },
            },
          })
          .returning();
        decision = dec;
      } catch (err: any) {
        const [dec] = await db
          .insert(strategyExecutionDecisions)
          .values({
            signalId: signalEvent.id,
            deploymentId,
            userId,
            decision: "REJECTED",
            reasonCode: "PAPER_ORDER_FAILED",
            reasonDetails: err?.message ?? String(err),
          })
          .returning();
        decision = dec;
      }
    } else {
      const [dec] = await db
        .insert(strategyExecutionDecisions)
        .values({
          signalId: signalEvent.id,
          deploymentId,
          userId,
          decision: "REJECTED",
          reasonCode: riskRes.rejectReason,
        })
        .returning();
      decision = dec;
    }
  }

  return { signalEvent, decision };
}

let isShuttingDown = false;
async function evaluatorWorkerLoop(): Promise<void> {
  console.log(`[strategy-evaluator] Starting strategy evaluator worker`);
  process.on("SIGTERM", () => { isShuttingDown = true; });
  process.on("SIGINT", () => { isShuttingDown = true; });

  while (!isShuttingDown) {
    try {
      // Poll active deployments using typed fields
      const activeDeployments = await db
        .select()
        .from(strategyDeployments)
        .where(eq(strategyDeployments.status, "ACTIVE"));

      for (const depRow of activeDeployments) {
        const deployment: DeploymentEvaluationContext = {
          id: depRow.id,
          userId: depRow.userId,
          strategyVersionId: depRow.strategyVersionId,
          mode: depRow.mode as any,
          universe: depRow.universe,
          timeframe: depRow.timeframe,
          status: depRow.status,
          riskLimits: (depRow.riskLimits as DeploymentRiskLimits) ?? {},
          userKillSwitch: depRow.userKillSwitch,
          deploymentKillSwitch: depRow.deploymentKillSwitch,
          lastEvaluatedAt: depRow.lastEvaluatedAt,
          lastSignalAt: depRow.lastSignalAt,
        };

        // Parse universe symbols (supporting '|' and ',' separators)
        const symbols = deployment.universe
          .split(/[|,]/)
          .map((s) => s.trim())
          .filter(Boolean);

        for (const sym of symbols) {
          const barRows = await db
            .select()
            .from(candles)
            .where(and(eq(candles.symbol, sym), eq(candles.timeframe, deployment.timeframe)))
            .orderBy(desc(candles.ts))
            .limit(100);

          if (barRows.length > 0) {
            const barCandles: Candle[] = barRows.reverse().map((r) => ({
              symbol: r.symbol,
              tf: r.timeframe as any,
              ts: r.ts.toISOString(),
              open: Number(r.open),
              high: Number(r.high),
              low: Number(r.low),
              close: Number(r.close),
              volume: r.volume ?? 0,
              source: r.source,
            }));

            const latestBar = barCandles[barCandles.length - 1];
            await evaluateDeploymentForBar(deployment, latestBar, barCandles);
          }
        }

        // Update lastEvaluatedAt
        await db
          .update(strategyDeployments)
          .set({ lastEvaluatedAt: new Date(), updatedAt: new Date() })
          .where(eq(strategyDeployments.id, deployment.id));
      }
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      console.error(`[strategy-evaluator] Error in evaluator loop:`, err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log(`[strategy-evaluator] Shutdown complete.`);
  process.exit(0);
}

if (import.meta.main || process.argv[1]?.endsWith("strategy-evaluator.ts")) {
  evaluatorWorkerLoop().catch((err) => {
    console.error("[strategy-evaluator] Fatal error:", err);
    process.exit(1);
  });
}
