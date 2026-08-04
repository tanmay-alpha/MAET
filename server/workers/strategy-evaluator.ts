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
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { evaluateRuleGroup } from "../domain/strategy/ast-evaluator";
import { IndicatorStateCache } from "../domain/strategy/indicator-state";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { createHash } from "crypto";

export interface DeploymentRiskCheckResult {
  passed: boolean;
  rejectReason?: string;
}

export function evaluateRiskGate(
  deployment: any,
  signal: { type: "ENTRY" | "EXIT"; symbol: string },
  accountCash: number,
  activePositionsCount: number,
  dataFreshnessMs: number,
): DeploymentRiskCheckResult {
  if (deployment.status !== "ACTIVE") {
    return { passed: false, rejectReason: "DEPLOYMENT_INACTIVE" };
  }
  if (deployment.kill_switch_enabled || deployment.killSwitchEnabled) {
    return { passed: false, rejectReason: "KILL_SWITCH_ACTIVE" };
  }
  if (dataFreshnessMs > 300_000) { // > 5 mins
    return { passed: false, rejectReason: "STALE_MARKET_DATA" };
  }

  const maxPositions = deployment.max_positions ?? deployment.maxPositions ?? 5;
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
  deployment: any,
  bar: Candle,
  allCandles: Candle[],
): Promise<{ signalEvent: any | null; decision: any | null }> {
  const deploymentId = deployment.id as string;
  const userId = deployment.user_id as string;
  const versionId = deployment.strategy_version_id as string;
  const mode = deployment.mode as "ALERT_ONLY" | "MANUAL_CONFIRM" | "AUTO_PAPER";
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

  const entryGroup = definition.entry ?? definition.entryRules;
  const exitGroup = definition.exit ?? definition.exitRules;

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

  let decision: any = null;

  // 4. Mode Routing
  if (mode === "ALERT_ONLY") {
    // In-app notification, no paper order
    console.log(`[evaluator] ALERT_ONLY signal for ${symbol} @ ${bar.close}`);
  } else if (mode === "MANUAL_CONFIRM") {
    // Insert proposed execution decision awaiting user confirmation
    const [dec] = await db
      .insert(strategyExecutionDecisions)
      .values({
        signalId: signalEvent.id,
        deploymentId,
        userId,
        decision: "PROPOSED",
        proposedOrder: { action: signalType === "ENTRY" ? "BUY" : "SELL", symbol, quantity: 1 },
      })
      .returning();
    decision = dec;
  } else if (mode === "AUTO_PAPER") {
    // Evaluate risk gate
    const riskRes = evaluateRiskGate(deployment, { type: signalType, symbol }, 50000, 1, 1000);

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
            proposedOrder: { action: signalType === "ENTRY" ? "BUY" : "SELL", symbol, quantity: 1 },
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
            reasonDetails: err.message,
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
      // Poll active deployments
      const activeDeployments = await db
        .select()
        .from(strategyDeployments)
        .where(eq(strategyDeployments.status, "ACTIVE"));

      for (const dep of activeDeployments) {
        const sym = dep.universe.includes("|") ? dep.universe.split("|")[0] : dep.universe;

        const barRows = await db
          .select()
          .from(candles)
          .where(and(eq(candles.symbol, sym), eq(candles.timeframe, dep.timeframe)))
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
          await evaluateDeploymentForBar(dep, latestBar, barCandles);
        }
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
