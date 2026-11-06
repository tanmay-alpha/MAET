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
import type { PaperTradingWriteRepository } from "./repository";
import { applyFill, freshestPositionMark } from "./fill-writer";
import { computeQuoteFingerprint } from "./quote-fingerprint";
import { signedPositionQuantity } from "./mapper";

export const MARGIN_CALL_REASON = "MARGIN_CALL_LIQUIDATION";

export interface LiquidationRequest {
  userId: string;
  reason: string;
  /**
   * Fresh executable (live, same-exchange) quote for a position, if any. Only these quotes
   * are traded at. For the breach test a position without one is marked at its last stored
   * mark (the quote of its latest fill), exactly as calculate_live_margin does; the entry
   * price is used only for a legacy row that has no stored mark.
   */
  quoteFor: (exchange: string, symbol: string) => ExecutionQuote | undefined;
}

export interface LiquidationOutcome {
  status: PaperAccountStatus;
  closedPositions: number;
  openPositions: number;
}

export class PaperTradingLiquidationService {
  /**
   * Margin-call liquidation in a single serializable transaction. Under the account lock it
   * re-checks the breach in both ACTIVE and LIQUIDATION_PENDING states:
   * - ACTIVE and breached: lock the account (LIQUIDATION_PENDING) and cancel working orders;
   * - LIQUIDATION_PENDING and no longer breached: release it back to ACTIVE;
   * then close every position that has an executable quote with a side-aware MARKET order,
   * fill and ledger entries, marking the account LIQUIDATED once flat. Positions without a
   * quote stay open with the account LIQUIDATION_PENDING until a later call closes them (the
   * risk monitor retries every pending account as quotes arrive) or the user closes them: a
   * pending account still accepts MARKET orders that only reduce a position. No fill price is
   * ever invented for a position that has no quote.
   * Returns null when there is nothing to do (account missing, liquidated, or not in breach).
   */
  async liquidateAccount(request: LiquidationRequest): Promise<LiquidationOutcome | null> {
    return withSerializablePaperTransaction((repos) => this.settleWithinTransaction(repos.write, request));
  }

  /**
   * The same settlement inside the caller's serializable transaction, so a user's closing
   * fill on a pending account and the re-check of that account commit together.
   */
  async settleWithinTransaction(
    write: PaperTradingWriteRepository,
    request: LiquidationRequest
  ): Promise<LiquidationOutcome | null> {
    const { userId, reason, quoteFor } = request;
    let account = await write.findAccountForUpdate({ userId });
    if (!account || account.status === "LIQUIDATED") {
      return null;
    }

    let positions = await write.findPositionsForUpdate({ userId, generation: account.generation });
    const events: NewPaperOutboxEventRow[] = [];
    const eventBase = { userId, generation: account.generation };

    const markedEquity = positions.reduce((equity, position) => {
      const entry = Number(position.averageEntryPrice);
      const mark = freshestPositionMark(position, quoteFor) ?? entry;
      return equity + signedPositionQuantity(position) * (mark - entry);
    }, Number(account.cashBalance));
    const breached = markedEquity < Number(account.maintenanceMargin);

    if (!breached) {
      if (account.status !== "LIQUIDATION_PENDING") {
        return null;
      }
      // The marked equity no longer breaches maintenance margin (prices recovered, or the user
      // closed positions): release the lock. Orders cancelled by the margin call stay cancelled.
      const now = new Date();
      account = await write.updateAccount(userId, {
        status: "ACTIVE",
        isLocked: false,
        lockReason: null,
        lockedAt: null,
        version: account.version + 1,
        updatedAt: now,
      });
      await write.insertOutboxEvents([
        buildAccountUpdatedEvent({
          ...eventBase,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { version: account.version, status: account.status, equity: markedEquity },
        }),
      ]);
      return { status: account.status, closedPositions: 0, openPositions: positions.length };
    }

    if (account.status === "ACTIVE") {
      const now = new Date();
      account = await write.updateAccount(userId, {
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

      const cancelled = await write.cancelOpenOrders({
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
      const order = await write.insertOrder({
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
          write,
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
          liveQuoteFor: quoteFor,
        });
        account = applied.account;
        closedPositions++;
      } catch (err) {
        if (!(err instanceof PaperExecutionError)) {
          throw err;
        }
        // Never leave a working MARKET order behind for the matcher to pick up.
        await write.updateOrder(order.id, { status: "REJECTED", rejectReason: err.message, updatedAt: now });
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
      positions = await write.findPositionsForUpdate({ userId, generation: account.generation });
    }

    const isFlat = positions.length === 0;
    if (!isFlat && closedPositions === 0 && account.status === "LIQUIDATION_PENDING" && events.length === 0) {
      // Still waiting for a quote: nothing changed, so neither bump the version nor emit an
      // event on every monitor cycle.
      return { status: account.status, closedPositions, openPositions: positions.length };
    }
    const now = new Date();
    account = await write.updateAccount(userId, {
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
    await write.insertOutboxEvents(events);

    return { status: account.status, closedPositions, openPositions: positions.length };
  }
}

export const paperTradingLiquidationService = new PaperTradingLiquidationService();
