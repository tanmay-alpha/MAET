import { eq, sql } from "drizzle-orm";
import { getDb } from "../../data/drizzle/client";
import { paperAccounts } from "../../db/schema";
import { evaluateExecutionQuote, type ExecutionQuote, type Tick } from "@shared/types";
import { paperExecutionPolicy } from "./fill-writer";
import { paperTradingLiquidationService, type PaperTradingLiquidationService } from "./liquidation-service";

const MARGIN_CALL_REASON = "MARGIN_CALL_LIQUIDATION";

function quoteKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol.trim().toUpperCase()}`;
}

/**
 * Watches paper accounts for margin breaches using the latest tick per exchange:symbol and
 * hands breached (and still LIQUIDATION_PENDING) accounts to the liquidation service.
 */
export class PaperRiskMonitor {
  private readonly ticks = new Map<string, Tick>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly liquidation: PaperTradingLiquidationService = paperTradingLiquidationService) {}

  /**
   * Keeps the latest executable (live, fresh) tick per EXCHANGE:SYMBOL. Delayed or stale
   * ticks are ignored, so they can neither start a margin call nor overwrite a live price.
   */
  updateQuote(tick: Tick): void {
    if (!evaluateExecutionQuote(tick, tick.symbol, paperExecutionPolicy()).executable) return;
    this.ticks.set(quoteKey(tick.exchange, tick.symbol), tick);
  }

  start(intervalMs = 2000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.monitorRisk().catch((err) => console.error("[RiskMonitor] error during risk monitoring:", err));
    }, intervalMs);
    console.log(`[RiskMonitor] Started background risk monitoring at ${intervalMs}ms interval`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[RiskMonitor] Stopped background risk monitoring");
  }

  /** Latest tick for the instrument, only while it is still executable under the paper quote policy. */
  private executableQuote(exchange: string, symbol: string): ExecutionQuote | undefined {
    const tick = this.ticks.get(quoteKey(exchange, symbol));
    if (!tick || !evaluateExecutionQuote(tick, tick.symbol, paperExecutionPolicy()).executable) {
      return undefined;
    }
    return {
      exchange: tick.exchange,
      symbol: tick.symbol,
      price: tick.price,
      volume: tick.volume,
      ts: tick.ts,
      source: tick.source,
      quality: tick.quality,
    };
  }

  async monitorRisk(): Promise<void> {
    if (this.running || this.ticks.size === 0) return;
    this.running = true;
    try {
      const db = getDb();
      // Mark only at quotes that are still executable now; a tick that has aged out is no mark.
      const prices = Object.fromEntries(
        [...this.ticks].flatMap(([key, tick]) =>
          this.executableQuote(tick.exchange, tick.symbol) ? [[key, tick.price]] : []
        )
      );
      // Bound as text and cast in SQL so the driver cannot re-encode the JSON document.
      const breached = await db.execute<{ user_id: string }>(
        sql`SELECT user_id FROM calculate_live_margin(${JSON.stringify(prices)}::text::jsonb)`
      );
      const pending = await db
        .select({ userId: paperAccounts.userId })
        .from(paperAccounts)
        .where(eq(paperAccounts.status, "LIQUIDATION_PENDING"));

      const userIds = new Set([...breached.map((row) => row.user_id), ...pending.map((row) => row.userId)]);
      if (breached.length > 0) {
        console.warn(`[RiskMonitor] Detected ${breached.length} breached accounts requiring liquidation`);
      }

      for (const userId of userIds) {
        try {
          await this.liquidation.liquidateAccount({
            userId,
            reason: MARGIN_CALL_REASON,
            quoteFor: (exchange, symbol) => this.executableQuote(exchange, symbol),
          });
        } catch (err) {
          console.error(`[RiskMonitor] Failed to liquidate breached account for user ${userId}:`, err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const paperRiskMonitor = new PaperRiskMonitor();
