import { withSerializablePaperTransaction } from "./transaction-retry";
import {
  buildLiquidationStartedEvent,
  buildLiquidationCompletedEvent,
  buildOrderCancelledEvent,
  buildPositionUpdatedEvent,
  buildAccountUpdatedEvent,
} from "./outbox";
import type { Tick } from "@shared/types";
import { parseExecutionQuote, evaluateExecutionQuote } from "@shared/types/market";
import { executePaperFill } from "@shared/domain/paper-trading/execution";
import type { PaperAccount, PaperOrder } from "@shared/domain/paper-trading/types";

export class PaperTradingLiquidationService {
  async initiateLiquidation(userId: string, reason: string): Promise<boolean> {
    return withSerializablePaperTransaction(async (repos) => {
      const account = await repos.write.findAccountForUpdate({ userId });
      if (!account || account.status !== "ACTIVE") {
        return false;
      }

      await repos.write.updateAccount(userId, {
        status: "LIQUIDATION_PENDING",
        isLocked: true,
        lockReason: reason,
        lockedAt: new Date(),
        version: Number(account.version) + 1,
        updatedAt: new Date(),
      });

      const cancelledOrders = await repos.write.cancelOpenOrders({
        userId,
        generation: account.generation,
        reason: `Account liquidation initiated: ${reason}`,
      });

      const outboxEvents = [
        buildLiquidationStartedEvent({
          userId,
          generation: account.generation,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { reason, initiatedAt: new Date().toISOString() },
        }),
      ];

      for (const order of cancelledOrders) {
        outboxEvents.push(
          buildOrderCancelledEvent({
            userId,
            generation: account.generation,
            aggregateType: "PaperOrder",
            aggregateId: order.id,
            payload: { orderId: order.id, reason: order.rejectReason },
          })
        );
      }

      await repos.write.insertOutboxEvents(outboxEvents);
      return true;
    });
  }

  async processPositionLiquidation(userId: string, quoteTick: Tick): Promise<boolean> {
    const symbol = quoteTick.symbol.trim().toUpperCase();
    const exchange = quoteTick.exchange || "NSE";

    const parsedQuoteResult = parseExecutionQuote(quoteTick, symbol);
    if (!parsedQuoteResult.ok) {
      return false;
    }
    const quote = parsedQuoteResult.quote;
    const policy = evaluateExecutionQuote(quote, symbol);
    if (!policy.executable) {
      return false;
    }

    return withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.findAccountForUpdate({ userId });
      if (!accountRow || accountRow.status !== "LIQUIDATION_PENDING") {
        return false;
      }

      const positionRow = await repos.write.findPositionForUpdate({
        userId,
        generation: accountRow.generation,
        symbol,
        exchange,
      });

      if (!positionRow || positionRow.totalShares === 0) {
        return false;
      }

      const liquidationOrderId = crypto.randomUUID();
      const liquidationOrderRow = await repos.write.insertOrder({
        id: liquidationOrderId,
        userId,
        generation: accountRow.generation,
        symbol,
        exchange,
        side: "SELL",
        type: "MARKET",
        status: "PENDING",
        qty: positionRow.totalShares,
        filledQty: 0,
        version: 1,
        placedAt: new Date(),
        updatedAt: new Date(),
      });

      const domainAccount: PaperAccount = {
        version: 3,
        initialCash: Number(accountRow.initialCash),
        cash: Number(accountRow.cashBalance),
        allocatedMargin: Number(accountRow.allocatedMargin),
        maintenanceMargin: Number(accountRow.maintenanceMargin),
        realisedPnl: Number(accountRow.realisedPnl),
        status: "LIQUIDATION_PENDING",
        positions: [
          {
            symbol: positionRow.symbol,
            quantity: positionRow.totalShares,
            averagePrice: Number(positionRow.averageEntryPrice),
            marginLocked: Number(positionRow.marginLocked),
            realisedPnl: Number(positionRow.realizedPnl),
            unrealisedPnl: Number(positionRow.unrealizedPnl || 0),
            updatedAt: positionRow.updatedAt.toISOString(),
          },
        ],
        orders: [],
        fills: [],
      };

      const domainOrder: PaperOrder = {
        id: liquidationOrderId,
        symbol,
        side: "SELL",
        type: "MARKET",
        status: "PENDING",
        quantity: positionRow.totalShares,
        filledQuantity: 0,
        createdAt: liquidationOrderRow.placedAt.toISOString(),
        updatedAt: liquidationOrderRow.updatedAt.toISOString(),
      };

      const fillResult = executePaperFill({
        account: domainAccount,
        order: domainOrder,
        fillQuantity: positionRow.totalShares,
        quote,
        reason: "MARGIN_LIQUIDATION",
      });

      const fillRowId = crypto.randomUUID();

      await repos.write.updateOrder(liquidationOrderId, {
        status: "FILLED",
        filledQty: positionRow.totalShares,
        lastFillAt: new Date(),
        quoteSource: quote.source,
        quoteQuality: quote.quality,
        quoteTimestamp: new Date(quote.ts),
        referencePrice: String(fillResult.fill.referencePrice),
      });

      await repos.write.insertFill({
        id: fillRowId,
        orderId: liquidationOrderId,
        userId,
        generation: accountRow.generation,
        symbol,
        exchange,
        side: "SELL",
        quantity: positionRow.totalShares,
        referencePrice: String(fillResult.fill.referencePrice),
        fillPrice: String(fillResult.fill.fillPrice),
        slippage: String(fillResult.fill.slippage),
        fees: String(fillResult.fill.fees),
        realizedPnl: String(fillResult.fill.realisedPnl),
        quoteSource: quote.source,
        quoteQuality: quote.quality,
        quoteTimestamp: new Date(quote.ts),
        quoteFingerprint: `liq:${liquidationOrderId}`,
        executionReason: "MARGIN_LIQUIDATION",
        executionSequence: 1,
        executedAt: new Date(),
      });

      await repos.write.deletePosition({
        userId,
        generation: accountRow.generation,
        symbol,
        exchange,
      });

      const remainingPositions = await repos.write.findPositionsForUpdate({
        userId,
        generation: accountRow.generation,
      });

      const isFullyLiquidated = remainingPositions.length === 0;

      const newAccountVersion = Number(accountRow.version) + 1;
      const newStatus = isFullyLiquidated ? "LIQUIDATED" : "LIQUIDATION_PENDING";

      await repos.write.updateAccount(userId, {
        cashBalance: String(fillResult.account.cash),
        realisedPnl: String(fillResult.account.realisedPnl),
        status: newStatus,
        isLocked: true,
        liquidationCompletedAt: isFullyLiquidated ? new Date() : null,
        version: newAccountVersion,
        updatedAt: new Date(),
      });

      await repos.write.insertLedgerEntries([
        {
          id: crypto.randomUUID(),
          userId,
          generation: accountRow.generation,
          fillId: fillRowId,
          entryType: "EXECUTION_FEE",
          amount: String(-fillResult.fill.fees),
          balanceAfter: String(fillResult.account.cash),
          currency: "INR",
          sourceType: "LIQUIDATION_FILL",
          sourceId: fillRowId,
          metadata: { liquidation: true },
          createdAt: new Date(),
        },
      ]);

      const events = [
        buildPositionUpdatedEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperPosition",
          aggregateId: `${userId}:${symbol}`,
          payload: { symbol, liquidated: true },
        }),
        buildAccountUpdatedEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { version: newAccountVersion, status: newStatus },
        }),
      ];

      if (isFullyLiquidated) {
        events.push(
          buildLiquidationCompletedEvent({
            userId,
            generation: accountRow.generation,
            aggregateType: "PaperAccount",
            aggregateId: userId,
            payload: { completedAt: new Date().toISOString() },
          })
        );
      }

      await repos.write.insertOutboxEvents(events);
      return true;
    });
  }
}

export const paperTradingLiquidationService = new PaperTradingLiquidationService();
