import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../data/drizzle/client";
import { paperOrders } from "../../db/schema";
import { PaperExecutionError } from "@shared/domain/paper-trading/execution";
import { evaluateExecutionQuote, type ExecutionQuote, type Tick } from "@shared/types";
import type { MatchingReceipt, PaperOrderRow } from "./contracts";
import { computeQuoteFingerprint } from "./quote-fingerprint";
import { withSerializablePaperTransaction } from "./transaction-retry";
import { applyFill, paperExecutionPolicy } from "./fill-writer";

const MATCHABLE_ORDER_STATUSES = ["PENDING", "TRIGGER_PENDING", "TRIGGERED", "PARTIALLY_FILLED"] as const;
const MATCHABLE_STATUS_LOOKUP: Partial<Record<PaperOrderRow["status"], true>> = {
  PENDING: true,
  TRIGGER_PENDING: true,
  TRIGGERED: true,
  PARTIALLY_FILLED: true,
};

/** Share of the tick's volume a resting order may take per tick. */
const MAX_TICK_PARTICIPATION = 0.1;

export class PaperTradingTickProcessor {
  async processTick(tick: Tick): Promise<MatchingReceipt[]> {
    const policy = evaluateExecutionQuote(tick, tick.symbol, paperExecutionPolicy());
    if (!policy.executable) {
      return [];
    }

    const { exchange, symbol } = tick;
    const quote: ExecutionQuote = {
      exchange,
      symbol,
      price: tick.price,
      volume: tick.volume,
      ts: tick.ts,
      source: tick.source,
      quality: tick.quality,
    };

    const candidates = await getDb()
      .select({ id: paperOrders.id, userId: paperOrders.userId })
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.symbol, symbol),
          eq(paperOrders.exchange, exchange),
          inArray(paperOrders.status, [...MATCHABLE_ORDER_STATUSES])
        )
      )
      .orderBy(asc(paperOrders.placedAt));

    if (candidates.length === 0) {
      return [];
    }

    const fingerprint = computeQuoteFingerprint({
      exchange,
      symbol,
      source: tick.source,
      quality: tick.quality,
      timestamp: tick.ts,
      price: tick.price,
      volume: tick.volume,
    });

    const receipts: MatchingReceipt[] = [];
    for (const candidate of candidates) {
      try {
        const receipt = await withSerializablePaperTransaction(async (repos) => {
          const account = await repos.write.findAccountForUpdate({ userId: candidate.userId });
          if (!account || account.status !== "ACTIVE" || account.isLocked) {
            return null;
          }

          let order = await repos.write.findOrderForUpdate({ userId: candidate.userId, orderId: candidate.id });
          // The candidate list was read before any lock was taken: a cancel, fill or account
          // reset may have committed since. Only the locked row is authoritative.
          if (
            !order ||
            !MATCHABLE_STATUS_LOOKUP[order.status] ||
            order.generation !== account.generation ||
            order.lastQuoteFingerprint === fingerprint
          ) {
            return null;
          }

          if (order.type === "STOP_LOSS_LIMIT" && order.status === "TRIGGER_PENDING") {
            const stopPrice = Number(order.stopPrice);
            const isTriggered = order.side === "SELL" ? quote.price <= stopPrice : quote.price >= stopPrice;
            if (!isTriggered) {
              return null;
            }
            const now = new Date();
            order = await repos.write.updateOrder(order.id, { status: "TRIGGERED", triggeredAt: now, updatedAt: now });
          }

          if (order.type !== "MARKET") {
            const limitPrice = Number(order.limitPrice);
            const isMarketable = order.side === "BUY" ? quote.price <= limitPrice : quote.price >= limitPrice;
            if (!isMarketable) {
              return null;
            }
          }

          const positions = await repos.write.findPositionsForUpdate({
            userId: candidate.userId,
            generation: account.generation,
          });

          const remainingQuantity = order.qty - order.filledQty;
          const liquidityCap =
            quote.volume !== undefined && quote.volume >= 10
              ? Math.floor(quote.volume * MAX_TICK_PARTICIPATION)
              : remainingQuantity;
          const fillQuantity = Math.max(1, Math.min(remainingQuantity, liquidityCap));

          try {
            const applied = await applyFill({
              write: repos.write,
              account,
              order,
              positions,
              quote,
              quoteFingerprint: fingerprint,
              fillQuantity,
              reason: order.type === "STOP_LOSS_LIMIT" ? "STOP_TRIGGER" : "USER_ORDER",
              ledgerSourceType: "FILL",
              now: new Date(),
              createId: () => crypto.randomUUID(),
            });
            return {
              orderId: order.id,
              fillId: applied.fill.id,
              symbol,
              fillPrice: Number(applied.fill.fillPrice),
              quantity: applied.fill.quantity,
              status: applied.isFullyFilled ? "FILLED" : "PARTIALLY_FILLED",
            } satisfies MatchingReceipt;
          } catch (err) {
            if (!(err instanceof PaperExecutionError)) {
              throw err;
            }
            // Business rejection (e.g. insufficient margin): the order stays working.
            console.error(`[TickProcessor] Fill execution rejected for order ${order.id}`, {
              orderId: order.id,
              userId: candidate.userId,
              symbol,
              code: err.code,
              reason: err.message,
            });
            return null;
          }
        });

        if (receipt) {
          receipts.push(receipt);
        }
      } catch (err) {
        console.error(`[TickProcessor] Error processing candidate order ${candidate.id}:`, err);
      }
    }

    return receipts;
  }
}

export const paperTradingTickProcessor = new PaperTradingTickProcessor();
