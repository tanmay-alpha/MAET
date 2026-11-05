import { withSerializablePaperTransaction } from "./transaction-retry";
import {
  buildLiquidationStartedEvent,
  buildLiquidationCompletedEvent,
  buildOrderCancelledEvent,
  buildOrderRejectedEvent,
  buildAccountUpdatedEvent,
} from "./outbox";
import type { ExecutionQuote } from "@shared/types/market";
import type { PaperAccountStatus } from "@shared/domain/paper-trading/types";
import { PaperExecutionError } from "@shared/domain/paper-trading/execution";
import type { NewPaperOutboxEventRow } from "./contracts";
import { applyFill } from "./fill-writer";
import { computeQuoteFingerprint } from "./quote-fingerprint";
import { signedPositionQuantity } from "./mapper";

export interface LiquidationRequest {
  userId: string;
  reason: string;
  /** Latest executable quote for a position's exchange and symbol, if one is available. */
  quoteFor: (exchange: string, symbol: string) => ExecutionQuote | undefined;
}

export interface LiquidationOutcome {
  status: PaperAccountStatus;
  closedPositions: number;
  openPositions: number;
}

export class PaperTradingLiquidationService {
  /**
   * Margin-call liquidation in a single serializable transaction: re-checks the breach under
   * the account lock, locks the account (LIQUIDATION_PENDING), cancels its working orders and
   * closes every position that has an executable quote with a side-aware MARKET order, fill and
   * ledger entries. Positions without a quote stay open and the account stays
   * LIQUIDATION_PENDING until a later call closes them; the account becomes LIQUIDATED once flat.
   * Returns null when there is nothing to do (account missing, already liquidated, or no longer
   * in breach).
   */
  async liquidateAccount(request: LiquidationRequest): Promise<LiquidationOutcome | null> {
    const { userId, reason, quoteFor } = request;

    return withSerializablePaperTransaction(async (repos) => {
      let account = await repos.write.findAccountForUpdate({ userId });
      if (!account || account.status === "LIQUIDATED") {
        return null;
      }

      let positions = await repos.write.findPositionsForUpdate({ userId, generation: account.generation });
      const events: NewPaperOutboxEventRow[] = [];
      const eventBase = { userId, generation: account.generation };

      if (account.status === "ACTIVE") {
        const markedEquity = positions.reduce((equity, position) => {
          const mark = quoteFor(position.exchange, position.symbol)?.price ?? Number(position.averageEntryPrice);
          return equity + signedPositionQuantity(position) * (mark - Number(position.averageEntryPrice));
        }, Number(account.cashBalance));
        if (markedEquity >= Number(account.maintenanceMargin)) {
          return null;
        }

        const now = new Date();
        account = await repos.write.updateAccount(userId, {
          status: "LIQUIDATION_PENDING",
          isLocked: true,
          lockReason: reason,
          lockedAt: now,
          version: account.version + 1,
          updatedAt: now,
        });
        events.push(
          buildLiquidationStartedEvent({
            ...eventBase,
            aggregateType: "PaperAccount",
            aggregateId: userId,
            payload: { reason, equity: markedEquity, maintenanceMargin: Number(account.maintenanceMargin) },
          })
        );

        const cancelled = await repos.write.cancelOpenOrders({
          userId,
          generation: account.generation,
          reason: `Account liquidation initiated: ${reason}`,
        });
        for (const order of cancelled) {
          events.push(
            buildOrderCancelledEvent({
              ...eventBase,
              aggregateType: "PaperOrder",
              aggregateId: order.id,
              payload: { orderId: order.id, reason: order.rejectReason },
            })
          );
        }
      }

      let closedPositions = 0;
      for (const position of [...positions]) {
        const quote = quoteFor(position.exchange, position.symbol);
        if (!quote) {
          continue;
        }

        const now = new Date();
        const order = await repos.write.insertOrder({
          id: crypto.randomUUID(),
          userId,
          generation: account.generation,
          symbol: position.symbol,
          exchange: position.exchange,
          side: position.side === "SHORT" ? "BUY" : "SELL",
          type: "MARKET",
          status: "PENDING",
          qty: position.totalShares,
          filledQty: 0,
          quoteSource: quote.source,
          quoteQuality: quote.quality,
          quoteTimestamp: new Date(quote.ts),
          referencePrice: String(quote.price),
          version: 1,
          placedAt: now,
          updatedAt: now,
        });

        try {
          const applied = await applyFill({
            write: repos.write,
            account,
            order,
            positions,
            quote,
            quoteFingerprint: computeQuoteFingerprint({ ...quote }),
            fillQuantity: position.totalShares,
            reason: "MARGIN_LIQUIDATION",
            ledgerSourceType: "LIQUIDATION_FILL",
            now,
            createId: () => crypto.randomUUID(),
          });
          account = applied.account;
          closedPositions++;
        } catch (err) {
          if (!(err instanceof PaperExecutionError)) {
            throw err;
          }
          // Never leave a working MARKET order behind for the matcher to pick up.
          await repos.write.updateOrder(order.id, { status: "REJECTED", rejectReason: err.message, updatedAt: now });
          events.push(
            buildOrderRejectedEvent({
              ...eventBase,
              aggregateType: "PaperOrder",
              aggregateId: order.id,
              payload: { orderId: order.id, reason: err.message },
            })
          );
          console.error(`[Liquidation] Could not close ${position.exchange}:${position.symbol} for ${userId}`, {
            code: err.code,
            reason: err.message,
          });
        }
        positions = await repos.write.findPositionsForUpdate({ userId, generation: account.generation });
      }

      const isFlat = positions.length === 0;
      const now = new Date();
      account = await repos.write.updateAccount(userId, {
        status: isFlat ? "LIQUIDATED" : "LIQUIDATION_PENDING",
        isLocked: true,
        liquidationCompletedAt: isFlat ? now : null,
        version: account.version + 1,
        updatedAt: now,
      });
      events.push(
        buildAccountUpdatedEvent({
          ...eventBase,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { version: account.version, status: account.status },
        })
      );
      if (isFlat) {
        events.push(
          buildLiquidationCompletedEvent({
            ...eventBase,
            aggregateType: "PaperAccount",
            aggregateId: userId,
            payload: { completedAt: now.toISOString() },
          })
        );
      }
      await repos.write.insertOutboxEvents(events);

      return { status: account.status, closedPositions, openPositions: positions.length };
    });
  }
}

export const paperTradingLiquidationService = new PaperTradingLiquidationService();
