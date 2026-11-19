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
  paperPortfolioSnapshots,
  userNotifications,
} from "../db/schema";
import { eq, and, desc, lt, max, sql } from "drizzle-orm";
import { evaluateRuleGroup } from "../domain/strategy/ast-evaluator";
import { IndicatorStateCache } from "../domain/strategy/indicator-state";
import { calculatePositionSize } from "../domain/strategy/position-sizer";
import { istDateKey } from "../domain/market/clock";
import { calculateMarkedUnrealisedPnl } from "../../shared/domain/paper-trading/margin";
import { signedPositionQuantity } from "../modules/paper-trading/mapper";
import type { PaperTradingService } from "../modules/paper-trading/service";
import { getConfig } from "../config";
import type {
  StrategyDefinition,
  StrategyDirection,
  StrategyOperand,
  StrategyRiskConfig,
  StrategyRuleGroup,
} from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { createHash } from "crypto";

/** Deployment risk limits as persisted by `DeploymentRiskLimitsSchema` (shared/strategy/schemas.ts). */
export interface DeploymentRiskLimits {
  maximumOpenPositions?: number;
  maximumPositionCapital?: number;
  maximumDailyLossPercent?: number;
  maximumDrawdownPercent?: number;
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

/** Paper account equity marks the daily-loss and drawdown limits are measured against. */
export interface DeploymentEquityState {
  /** Equity now: cash plus unrealised P&L marked at the latest known prices. */
  equity: number;
  /** Equity at the close of the previous trading session (or the generation's initial cash). */
  dayStartEquity: number;
  /** Highest equity the current paper account generation has reached. */
  peakEquity: number;
}

const DEFAULT_MAX_OPEN_POSITIONS = 5;
const MIN_ENTRY_CASH = 1000;

export function evaluateRiskGate(
  deployment: { status: string; riskLimits: unknown; userKillSwitch: boolean; deploymentKillSwitch: boolean },
  signal: { type: "ENTRY" | "EXIT"; symbol: string },
  accountCash: number,
  activePositionsCount: number,
  dataFreshnessMs: number,
  equityState?: DeploymentEquityState,
): DeploymentRiskCheckResult {
  if (deployment.status !== "ACTIVE") {
    return { passed: false, rejectReason: "DEPLOYMENT_INACTIVE" };
  }

  if (deployment.userKillSwitch || deployment.deploymentKillSwitch) {
    return { passed: false, rejectReason: "KILL_SWITCH_ACTIVE" };
  }

  if (dataFreshnessMs > 300_000) { // > 5 mins
    return { passed: false, rejectReason: "STALE_MARKET_DATA" };
  }

  // Limits only gate new risk: an exit always reduces exposure and must never be blocked by them.
  if (signal.type === "EXIT") return { passed: true };

  const limits = (deployment.riskLimits ?? {}) as DeploymentRiskLimits;
  const maxPositions = limits.maximumOpenPositions ?? DEFAULT_MAX_OPEN_POSITIONS;
  if (activePositionsCount >= maxPositions) {
    return { passed: false, rejectReason: "MAX_OPEN_POSITIONS_REACHED" };
  }

  if (accountCash < MIN_ENTRY_CASH) {
    return { passed: false, rejectReason: "INSUFFICIENT_ACCOUNT_CASH" };
  }

  if (equityState) {
    const { equity, dayStartEquity, peakEquity } = equityState;
    if (limits.maximumDailyLossPercent != null && dayStartEquity > 0) {
      const dailyLossPercent = ((dayStartEquity - equity) / dayStartEquity) * 100;
      if (dailyLossPercent >= limits.maximumDailyLossPercent) {
        return { passed: false, rejectReason: "DAILY_LOSS_LIMIT_REACHED" };
      }
    }
    if (limits.maximumDrawdownPercent != null && peakEquity > 0) {
      const drawdownPercent = ((peakEquity - equity) / peakEquity) * 100;
      if (drawdownPercent >= limits.maximumDrawdownPercent) {
        return { passed: false, rejectReason: "MAX_DRAWDOWN_REACHED" };
      }
    }
  }

  return { passed: true };
}

/** Risk config with the same defaults runner-v3 applies, so live sizing matches the backtest. */
export function strategyRiskConfig(definition: StrategyDefinition): StrategyRiskConfig {
  return {
    sizingMethod: "PERCENT_OF_EQUITY",
    sizeValue: 100,
    maximumOpenPositions: 1,
    allowPyramiding: false,
    ...(definition.risk ?? {}),
  };
}

/** Order side that opens a position; as in runner-v3, only SHORT_ONLY strategies enter short. */
export function entrySide(direction: StrategyDirection | undefined): "BUY" | "SELL" {
  return direction === "SHORT_ONLY" ? "SELL" : "BUY";
}

export interface EntrySizing {
  quantity: number;
  rejectReason?: string;
}

/**
 * Sizes an entry from the strategy's position sizing and the account equity (as runner-v3 does),
 * then caps its notional at the deployment's maximumPositionCapital.
 */
export function sizeAutoPaperEntry(
  definition: StrategyDefinition,
  limits: DeploymentRiskLimits,
  equity: number,
  price: number,
  atr: number | undefined,
): EntrySizing {
  const risk = strategyRiskConfig(definition);
  const stopPct = risk.stopLossPercent;
  const long = entrySide(definition.direction) === "BUY";
  const sizing = calculatePositionSize(risk, {
    currentEquity: equity,
    entryPrice: price,
    atr,
    stopPrice: stopPct ? price * (long ? 1 - stopPct / 100 : 1 + stopPct / 100) : undefined,
  });
  let quantity = sizing.quantity;
  if (quantity > 0 && sizing.capitalRequired > equity) {
    return { quantity: 0, rejectReason: "INSUFFICIENT_EQUITY" };
  }
  if (limits.maximumPositionCapital != null) {
    quantity = Math.min(quantity, Math.floor(limits.maximumPositionCapital / price));
    if (quantity <= 0) return { quantity: 0, rejectReason: "MAX_POSITION_CAPITAL_TOO_SMALL" };
  }
  if (quantity <= 0) return { quantity: 0, rejectReason: "POSITION_SIZE_ZERO" };
  return { quantity };
}

/** walk-forward's default warm-up; also enough for the 50-bar minimum runner-v3 enforces. */
const MIN_HISTORY_BARS = 250;
/** Recursive indicators (EMA, RSI, ATR, MACD, Supertrend) need several lookbacks to converge. */
const RECURSIVE_CONVERGENCE_FACTOR = 5;

function operandLookback(operand: StrategyOperand | undefined): number {
  if (!operand) return 0;
  const lag = "lag" in operand ? operand.lag ?? 0 : 0;
  if (operand.kind === "INDICATOR") {
    const p = operand.params ?? {};
    const period = p.period ?? 14;
    switch (operand.indicator) {
      case "MACD_LINE":
      case "MACD_SIGNAL":
      case "MACD_HISTOGRAM":
        return (p.slowPeriod ?? 26) + (p.signalPeriod ?? 9) + lag;
      case "VWAP":
      case "OBV":
        return lag;
      default:
        return period + lag;
    }
  }
  if (operand.kind === "MARKET") return (operand.field === "RELATIVE_VOLUME" ? 20 : 1) + lag;
  return lag;
}

function groupLookback(group: StrategyRuleGroup | undefined): number {
  if (!group?.children) return 0;
  let longest = 0;
  for (const child of group.children) {
    longest = Math.max(
      longest,
      child.kind === "GROUP"
        ? groupLookback(child)
        : Math.max(operandLookback(child.left), operandLookback(child.right), operandLookback(child.rightHigh)),
    );
  }
  return longest;
}

/**
 * Candles to load so indicator values at the latest bar match a backtest over full history:
 * the longest indicator lookback times a convergence factor, never fewer than MIN_HISTORY_BARS.
 */
export function requiredHistoryBars(definition: StrategyDefinition): number {
  const lookback = Math.max(
    groupLookback(definition.entry ?? definition.entryRules),
    groupLookback(definition.exit ?? definition.exitRules),
    14, // ATR(14) used by VOLATILITY_TARGET sizing
  );
  // +2: rules are read on the bar before the latest one, and crosses compare with the bar before that.
  return Math.max(MIN_HISTORY_BARS, lookback * RECURSIVE_CONVERGENCE_FACTOR) + 2;
}

const TIMEFRAME_MS: Record<Candle["tf"], number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
  "1wk": 7 * 86_400_000,
};

/** Age of a completed bar's data, measured from the bar's close (open `ts` + timeframe), not its open. */
export function barDataFreshnessMs(bar: Pick<Candle, "ts" | "tf">, nowMs: number): number {
  return nowMs - (new Date(bar.ts).getTime() + TIMEFRAME_MS[bar.tf]);
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

interface PaperPositionSnapshot {
  symbol: string;
  side: string;
  totalShares: number;
  averageEntryPrice: string;
  lastQuotePrice: string | null;
}

export interface AutoPaperState {
  cash: number;
  positions: PaperPositionSnapshot[];
  equity: DeploymentEquityState;
}

/** Loads the user's current-generation paper account, its open positions, and its equity marks. */
export async function loadPaperState(
  userId: string,
  mark: { symbol: string; price: number } | null,
  now: Date,
): Promise<AutoPaperState> {
  const [account] = await db
    .select()
    .from(paperAccounts)
    .where(eq(paperAccounts.userId, userId))
    .limit(1);
  if (!account) {
    // placeOrder opens the account with the configured initial cash on first use.
    const initialCash = getConfig().paperInitialCashInr;
    return { cash: initialCash, positions: [], equity: { equity: initialCash, dayStartEquity: initialCash, peakEquity: initialCash } };
  }

  const positions = await db
    .select({
      symbol: paperPositions.symbol,
      side: paperPositions.side,
      totalShares: paperPositions.totalShares,
      averageEntryPrice: paperPositions.averageEntryPrice,
      lastQuotePrice: paperPositions.lastQuotePrice,
    })
    .from(paperPositions)
    .where(and(
      eq(paperPositions.userId, userId),
      eq(paperPositions.generation, account.generation),
      sql`${paperPositions.totalShares} > 0`,
    ));

  const cash = Number(account.cashBalance);
  const initialCash = Number(account.initialCash);
  // Equity = cash + unrealised P&L (paper positions are margined), marked at `mark` for its symbol.
  const unrealised = positions.reduce((sum, p) => {
    const price = p.symbol === mark?.symbol ? mark.price : Number(p.lastQuotePrice ?? p.averageEntryPrice);
    return sum + calculateMarkedUnrealisedPnl(
      { quantity: signedPositionQuantity(p), averagePrice: Number(p.averageEntryPrice) },
      price,
    );
  }, 0);
  const equity = cash + unrealised;

  const generationSnapshots = and(
    eq(paperPortfolioSnapshots.userId, userId),
    eq(paperPortfolioSnapshots.generation, account.generation),
  );
  const [previousClose] = await db
    .select({ equity: paperPortfolioSnapshots.equity })
    .from(paperPortfolioSnapshots)
    .where(and(generationSnapshots, lt(paperPortfolioSnapshots.snapshotDate, istDateKey(now))))
    .orderBy(desc(paperPortfolioSnapshots.snapshotDate))
    .limit(1);
  const [peak] = await db
    .select({ equity: max(paperPortfolioSnapshots.equity) })
    .from(paperPortfolioSnapshots)
    .where(generationSnapshots);

  return {
    cash,
    positions,
    equity: {
      equity,
      dayStartEquity: previousClose ? Number(previousClose.equity) : initialCash,
      peakEquity: Math.max(initialCash, equity, peak?.equity == null ? 0 : Number(peak.equity)),
    },
  };
}

/**
 * Side and size of the paper order a signal trades: entries are sized like runner-v3 in the
 * strategy's direction; exits close the held position in full.
 */
function planPaperOrder(
  signalType: "ENTRY" | "EXIT",
  definition: StrategyDefinition,
  limits: DeploymentRiskLimits,
  state: AutoPaperState,
  heldPosition: PaperPositionSnapshot | null,
  bar: Candle,
  cache: IndicatorStateCache,
  signalIdx: number,
): { side: "BUY" | "SELL"; quantity: number } | { rejectReason: string } {
  if (signalType === "EXIT") {
    // Paper-trading modes signal EXIT only while positioned.
    if (!heldPosition) return { rejectReason: "NO_OPEN_POSITION" };
    return { side: heldPosition.side === "SHORT" ? "BUY" : "SELL", quantity: heldPosition.totalShares };
  }
  const sizing = sizeAutoPaperEntry(
    definition,
    limits,
    state.equity.equity,
    bar.close,
    cache.resolve("ATR", { period: 14 }, signalIdx) ?? undefined,
  );
  if (!sizing.quantity) return { rejectReason: sizing.rejectReason ?? "POSITION_SIZE_ZERO" };
  return { side: entrySide(definition.direction), quantity: sizing.quantity };
}

export interface EvaluateDeploymentOptions {
  /** Paper order API; defaults to the canonical PaperTradingService. */
  paperService?: Pick<PaperTradingService, "placeOrder">;
  now?: () => Date;
}

export async function evaluateDeploymentForBar(
  deployment: DeploymentEvaluationContext,
  bar: Candle,
  allCandles: Candle[],
  options: EvaluateDeploymentOptions = {},
): Promise<{ signalEvent: any | null; decision: any | null }> {
  const deploymentId = deployment.id;
  const userId = deployment.userId;
  const versionId = deployment.strategyVersionId;
  const mode = deployment.mode;
  const symbol = bar.symbol;
  const timeframe = bar.tf;
  const now = options.now?.() ?? new Date();

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
  const signalIdx = barIndex - 1;

  const entryGroup = definition.entry ?? (definition as any).entryRules;
  const exitGroup = definition.exit ?? (definition as any).exitRules;

  const entryMatched = evaluateRuleGroup(entryGroup, cache, signalIdx).matched;
  const exitMatched = evaluateRuleGroup(exitGroup, cache, signalIdx).matched;

  // Paper-trading modes trade like runner-v3: flat → entry rules, positioned → exit rules. No pyramiding,
  // so a held entry condition never re-fires while the position is open, and an exit while flat is moot.
  const paperState = mode === "AUTO_PAPER" || mode === "MANUAL_CONFIRM" ? await loadPaperState(userId, { symbol, price: bar.close }, now) : null;
  const heldPosition = paperState?.positions.find((p) => p.symbol === symbol) ?? null;

  let signalType: "ENTRY" | "EXIT" | null = null;
  if (paperState) {
    if (heldPosition) signalType = exitMatched ? "EXIT" : null;
    else signalType = entryMatched ? "ENTRY" : null;
  } else if (entryMatched) signalType = "ENTRY";
  else if (exitMatched) signalType = "EXIT";

  if (!signalType) return { signalEvent: null, decision: null };

  // 3. Generate deterministic fingerprint; the unique (deployment, fingerprint) index makes a
  // re-evaluated bar a no-op even when two evaluators race.
  const fingerprint = computeSignalFingerprint(
    deploymentId,
    versionId,
    symbol,
    timeframe,
    bar.ts,
    signalType,
  );

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
    .onConflictDoNothing()
    .returning();

  if (!signalEvent) {
    const [existing] = await db
      .select()
      .from(strategySignalEvents)
      .where(and(eq(strategySignalEvents.deploymentId, deploymentId), eq(strategySignalEvents.fingerprint, fingerprint)))
      .limit(1);
    return { signalEvent: existing ?? null, decision: null };
  }

  // Update deployment lastSignalAt
  await db
    .update(strategyDeployments)
    .set({ lastSignalAt: new Date(), updatedAt: new Date() })
    .where(eq(strategyDeployments.id, deploymentId));

  const recordDecision = async (values: Omit<typeof strategyExecutionDecisions.$inferInsert, "signalId" | "deploymentId" | "userId">) => {
    const [dec] = await db
      .insert(strategyExecutionDecisions)
      .values({ signalId: signalEvent.id, deploymentId, userId, ...values })
      .returning();
    return dec;
  };

  let decision: any = null;

  // 4. Mode Routing
  if (mode === "ALERT_ONLY") {
    decision = await recordDecision({
      decision: "ALERT_ONLY",
      reasonCode: "NOTIFICATION_EMITTED",
      reasonDetails: `Alert signal for ${symbol} @ ₹${bar.close}`,
    });

    await db.insert(userNotifications).values({
      userId,
      kind: "STRATEGY_SIGNAL",
      title: `Strategy Alert: ${symbol} ${signalType}`,
      body: `Deployment emitted ${signalType} signal for ${symbol} at ₹${bar.close} (${timeframe})`,
      symbol,
      payload: { deploymentId, signalId: signalEvent.id, price: bar.close },
    });
  } else if (mode === "MANUAL_CONFIRM" && paperState) {
    // The proposal carries the same side and size AUTO_PAPER would trade; confirmation re-runs the gate.
    const plan = planPaperOrder(signalType, definition, deployment.riskLimits ?? {}, paperState, heldPosition, bar, cache, signalIdx);
    if ("rejectReason" in plan) {
      return { signalEvent, decision: await recordDecision({ decision: "REJECTED", reasonCode: plan.rejectReason }) };
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    decision = await recordDecision({
      decision: "PROPOSED",
      proposedOrder: {
        symbol,
        exchange: "NSE",
        signalType,
        side: plan.side,
        type: "MARKET",
        quantity: plan.quantity,
        strategyVersionId: versionId,
        signalId: signalEvent.id,
        quoteMetadata: { price: bar.close, ts: bar.ts },
        expiresAt: expiresAt.toISOString(),
      },
    });
  } else if (mode === "AUTO_PAPER" && paperState) {
    if (process.env.GLOBAL_PAPER_AUTOMATION_ENABLED !== "true") {
      decision = await recordDecision({
        decision: "REJECTED",
        reasonCode: "GLOBAL_PAPER_AUTOMATION_DISABLED",
        reasonDetails: "Global paper automation is disabled by default for safety",
      });
      return { signalEvent, decision };
    }

    const riskRes = evaluateRiskGate(
      deployment,
      { type: signalType, symbol },
      paperState.cash,
      paperState.positions.length,
      barDataFreshnessMs(bar, now.getTime()),
      paperState.equity,
    );
    if (!riskRes.passed) {
      return { signalEvent, decision: await recordDecision({ decision: "REJECTED", reasonCode: riskRes.rejectReason }) };
    }

    const plan = planPaperOrder(signalType, definition, deployment.riskLimits ?? {}, paperState, heldPosition, bar, cache, signalIdx);
    if ("rejectReason" in plan) {
      return { signalEvent, decision: await recordDecision({ decision: "REJECTED", reasonCode: plan.rejectReason }) };
    }
    const { side, quantity } = plan;

    const proposedOrder = {
      symbol,
      exchange: "NSE",
      signalType,
      side,
      type: "MARKET",
      quantity,
      strategyVersionId: versionId,
      signalId: signalEvent.id,
      quoteMetadata: { price: bar.close, ts: bar.ts },
    };
    try {
      const service = options.paperService ?? new (await import("../modules/paper-trading/service")).PaperTradingService();
      // The key is derived from the signal fingerprint: a re-placed order for the same bar replays
      // (or, with different terms, is refused) instead of filling twice.
      const orderRes = await service.placeOrder({
        userId,
        command: { symbol, side, type: "MARKET", qty: quantity, idempotencyKey: `auto-${fingerprint}` },
      });
      decision = await recordDecision({ decision: "EXECUTED", paperOrderId: orderRes.order.id, proposedOrder });
    } catch (err: any) {
      decision = await recordDecision({
        decision: "REJECTED",
        reasonCode: "PAPER_ORDER_FAILED",
        reasonDetails: err?.message ?? String(err),
        proposedOrder,
      });
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
        const [versionRow] = await db
          .select({ definition: strategyVersions.definition })
          .from(strategyVersions)
          .where(eq(strategyVersions.id, depRow.strategyVersionId))
          .limit(1);
        if (!versionRow) continue;
        const historyBars = requiredHistoryBars(versionRow.definition as unknown as StrategyDefinition);

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
            .limit(historyBars);

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
