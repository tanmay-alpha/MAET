import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../data/drizzle/client";
import {
  paperOrders,
  paperAccounts,
} from "../../db/schema";
import { executePaperFill } from "@shared/domain/paper-trading/execution";
import type { PaperExecutionReason } from "@shared/domain/paper-trading/types";
import { evaluateExecutionQuote, type Tick } from "@shared/types";
import type { MatchingReceipt } from "./contracts";
import { mapPaperAccountRow, mapPaperOrderRow, mapPaperPositionRow } from "./mapper";
import { computeQuoteFingerprint } from "./quote-fingerprint";
import { withSerializablePaperTransaction } from "./transaction-retry";
import {
  buildOrderFilledEvent,
  buildOrderPartiallyFilledEvent,
  buildPositionUpdatedEvent,
  buildAccountUpdatedEvent,
} from "./outbox";

export class PaperTradingTickProcessor {
  async processTick(quote: Tick): Promise<MatchingReceipt[]> {
    const receipts: MatchingReceipt[] = [];

    const parsedQuoteResult = evaluateExecutionQuote(
      {
        exchange: quote.exchange,
        symbol: quote.symbol,
        price: quote.price,
        volume: quote.volume,
        ts: quote.ts,
        source: quote.source,
        quality: quote.quality,
      },
      quote.symbol
    );

    if (!parsedQuoteResult.executable) {
      return [];
    }

    const { exchange, symbol } = quote;

    const db = getDb();
    const candidateOrdersRows = await db
      .select({
        id: paperOrders.id,
        user_id: paperOrders.userId,
        generation: paperOrders.generation,
        type: paperOrders.type,
        status: paperOrders.status,
      })
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.symbol, symbol),
          eq(paperOrders.exchange, exchange),
          inArray(paperOrders.status, ["PENDING", "TRIGGER_PENDING", "TRIGGERED", "PARTIALLY_FILLED"])
        )
      );

    if (candidateOrdersRows.length === 0) {
      return [];
    }

    const fingerprint = computeQuoteFingerprint({
      exchange,
      symbol,
      source: quote.source,
      quality: quote.quality,
      timestamp: quote.ts,
      price: quote.price,
      volume: quote.volume,
    });

    for (const candidate of candidateOrdersRows) {
      try {
        const receipt = await withSerializablePaperTransaction(
          async (repos) => {
            const rawAccount = await repos.write.findAccountForUpdate({ userId: candidate.user_id });
            if (!rawAccount) {
              return null;
            }
            const accountRow = mapPaperAccountRow(rawAccount);

            if (accountRow.status === "LIQUIDATED" || accountRow.isLocked) {
              return null;
            }

            const rawOrder = await repos.write.findOrderForUpdate({
              userId: candidate.user_id,
              orderId: candidate.id,
            });
            if (!rawOrder) {
              return null;
            }
            const orderRow = mapPaperOrderRow(rawOrder);

            if (orderRow.lastQuoteFingerprint === fingerprint) {
              return null;
            }

            const rawPositions = await repos.write.findPositionsForUpdate({
              userId: candidate.user_id,
              generation: candidate.generation,
            });
            const positionRows = rawPositions.map(mapPaperPositionRow);

            let currentStatus = orderRow.status;

            if (orderRow.type === "STOP_LOSS_LIMIT" && currentStatus === "TRIGGER_PENDING") {
              const stopPrice = Number(orderRow.stopPrice);
              const isTriggered =
                orderRow.side === "SELL" ? quote.price <= stopPrice : quote.price >= stopPrice;

              if (isTriggered) {
                currentStatus = "TRIGGERED";
                await repos.write.updateOrder(orderRow.id, {
                  status: "TRIGGERED",
                  triggeredAt: new Date(),
                  updatedAt: new Date(),
                });
              } else {
                return null;
              }
            }

            if (orderRow.type === "LIMIT" || (orderRow.type === "STOP_LOSS_LIMIT" && currentStatus === "TRIGGERED")) {
              const limitPrice = Number(orderRow.limitPrice);
              const isMarketable =
                orderRow.side === "BUY" ? quote.price <= limitPrice : quote.price >= limitPrice;
              if (!isMarketable) {
                return null;
              }
            }

            const domainPositions = positionRows.map((pos) => ({
              symbol: pos.symbol,
              quantity: pos.totalShares,
              averagePrice: Number(pos.averageEntryPrice),
              marginLocked: Number(pos.marginLocked),
              realisedPnl: Number(pos.realizedPnl),
              unrealisedPnl: Number(pos.unrealizedPnl),
              updatedAt: pos.updatedAt?.toISOString() || new Date().toISOString(),
            }));

            const domainAccount = {
              id: accountRow.userId,
              userId: accountRow.userId,
              version: 3 as const,
              generation: accountRow.generation,
              currency: accountRow.currency as "INR",
              cash: Number(accountRow.cashBalance),
              initialCash: Number(accountRow.initialCash),
              realisedPnl: Number(accountRow.realisedPnl),
              allocatedMargin: Number(accountRow.allocatedMargin),
              maintenanceMargin: Number(accountRow.maintenanceMargin),
              status: accountRow.status as any,
              isLocked: accountRow.isLocked,
              positions: domainPositions,
              orders: [],
              fills: [],
              createdAt: accountRow.createdAt.toISOString(),
              updatedAt: accountRow.updatedAt.toISOString(),
            };

            const domainOrder = {
              id: orderRow.id,
              userId: orderRow.userId,
              symbol: orderRow.symbol,
              side: orderRow.side as "BUY" | "SELL",
              quantity: orderRow.qty,
              type: orderRow.type as any,
              status: currentStatus as any,
              limitPrice: orderRow.limitPrice ? Number(orderRow.limitPrice) : undefined,
              stopPrice: orderRow.stopPrice ? Number(orderRow.stopPrice) : undefined,
              triggeredAt: orderRow.triggeredAt?.toISOString(),
              filledQuantity: orderRow.filledQty,
              averageFillPrice: orderRow.averageFillPrice ? Number(orderRow.averageFillPrice) : undefined,
              stopLossPrice: orderRow.stopLossPrice ? Number(orderRow.stopLossPrice) : undefined,
              takeProfitPrice: orderRow.takeProfitPrice ? Number(orderRow.takeProfitPrice) : undefined,
              trailingDistance: orderRow.trailingDistance ? Number(orderRow.trailingDistance) : undefined,
              trailingIsPercent: orderRow.isTrailingPercent ?? undefined,
              createdAt: (orderRow.placedAt instanceof Date ? orderRow.placedAt : new Date(orderRow.placedAt || Date.now())).toISOString(),
              updatedAt: (orderRow.updatedAt instanceof Date ? orderRow.updatedAt : new Date(orderRow.updatedAt || Date.now())).toISOString(),
              parentOrderId: orderRow.parentOrderId || undefined,
            };

            const filledQty = Number(orderRow.filledQty || 0);
            const remainingQuantity = orderRow.qty - filledQty;
            const maxFill = quote.volume && quote.volume >= 10 ? Math.floor(quote.volume * 0.10) : remainingQuantity;
            const fillQuantity = Math.max(1, Math.min(remainingQuantity, maxFill > 0 ? maxFill : remainingQuantity));
            const reason: PaperExecutionReason = currentStatus === "TRIGGERED" ? "STOP_TRIGGER" : "USER_ORDER";

            let fillResult: any;
            try {
              fillResult = executePaperFill({
                account: domainAccount,
                order: domainOrder,
                quote,
                reason,
                fillQuantity,
              });
            } catch (err) {
              return null;
            }

            const fillPlan = fillResult.fill;
            const fillId = crypto.randomUUID();
            const now = new Date();

            const fillRow = await repos.write.insertFill({
              id: fillId,
              orderId: orderRow.id,
              userId: candidate.user_id,
              generation: orderRow.generation,
              executionSequence: 1,
              symbol,
              exchange,
              side: orderRow.side,
              quantity: fillPlan.quantity,
              referencePrice: String(fillPlan.referencePrice),
              fillPrice: String(fillPlan.fillPrice),
              slippage: String(fillPlan.slippage),
              fees: String(fillPlan.fees),
              realizedPnl: String(fillPlan.realisedPnl),
              quoteSource: quote.source,
              quoteQuality: quote.quality,
              quoteTimestamp: new Date(quote.ts),
              quoteFingerprint: fingerprint,
              executionReason: reason,
              executedAt: now,
              createdAt: now,
            });

            const prevFilledQty = Number(orderRow.filledQty || 0);
            const fillQty = fillPlan.quantity;
            const newFilledQty = prevFilledQty + fillQty;
            const isFullyFilled = newFilledQty >= orderRow.qty;
            const nextOrderStatus = isFullyFilled ? "FILLED" : "PARTIALLY_FILLED";

            const prevAvgPrice = orderRow.averageFillPrice ? Number(orderRow.averageFillPrice) : 0;
            const newAvgPrice =
              (prevAvgPrice * prevFilledQty + fillPlan.fillPrice * fillQty) / newFilledQty;

            await repos.write.updateOrder(orderRow.id, {
              status: nextOrderStatus,
              filledQty: newFilledQty,
              averageFillPrice: String(newAvgPrice),
              lastFillAt: now,
              updatedAt: now,
              lastQuoteFingerprint: fingerprint,
            });

            await repos.write.updateAccount(candidate.user_id, {
              cashBalance: String(fillResult.account.cash),
              allocatedMargin: String(fillResult.account.allocatedMargin),
              maintenanceMargin: String(fillResult.account.maintenanceMargin),
              realisedPnl: String(fillResult.account.realisedPnl),
              updatedAt: now,
            });

            const matchingPos = fillResult.account.positions.find((p: any) => p.symbol === symbol);
            if (matchingPos) {
              await repos.write.upsertPosition({
                id: crypto.randomUUID(),
                userId: candidate.user_id,
                generation: orderRow.generation,
                symbol,
                exchange,
                totalShares: Math.abs(matchingPos.quantity),
                averageEntryPrice: String(matchingPos.averagePrice),
                marginLocked: String(matchingPos.marginLocked),
                realizedPnl: String(matchingPos.realisedPnl),
                unrealizedPnl: String(matchingPos.unrealisedPnl),
                lastQuotePrice: String(quote.price),
                lastQuoteSource: quote.source,
                lastQuoteQuality: quote.quality,
                lastQuoteTimestamp: new Date(quote.ts),
                updatedAt: now,
              });
            } else {
              await repos.write.deletePosition({
                userId: candidate.user_id,
                generation: orderRow.generation,
                symbol,
                exchange,
              });
            }

            await repos.write.insertLedgerEntries([{
              id: crypto.randomUUID(),
              userId: candidate.user_id,
              generation: orderRow.generation,
              fillId: fillRow.id,
              entryType: (fillPlan.realisedPnl ?? 0) >= 0 ? "TRADE_PROFIT" : "TRADE_LOSS",
              amount: String(fillPlan.realisedPnl ?? 0),
              balanceAfter: String(fillResult.account.cash),
              currency: "INR",
              sourceType: "FILL",
              sourceId: fillRow.id,
              metadata: { fillId: fillRow.id, orderId: orderRow.id, fee: fillPlan.fees, slippage: fillPlan.slippage },
              createdAt: now,
            }]);

            const outboxEvents = [
              isFullyFilled
                ? buildOrderFilledEvent({
                    userId: candidate.user_id,
                    generation: orderRow.generation,
                    aggregateType: "PaperOrder",
                    aggregateId: orderRow.id,
                    payload: { orderId: orderRow.id, fillId: fillRow.id, fillPrice: fillPlan.fillPrice, quantity: fillPlan.quantity },
                  })
                : buildOrderPartiallyFilledEvent({
                    userId: candidate.user_id,
                    generation: orderRow.generation,
                    aggregateType: "PaperOrder",
                    aggregateId: orderRow.id,
                    payload: { orderId: orderRow.id, fillId: fillRow.id, fillPrice: fillPlan.fillPrice, quantity: fillPlan.quantity },
                  }),
              buildPositionUpdatedEvent({
                userId: candidate.user_id,
                generation: orderRow.generation,
                aggregateType: "PaperPosition",
                aggregateId: `${candidate.user_id}:${symbol}`,
                payload: { symbol, position: matchingPos || null },
              }),
              buildAccountUpdatedEvent({
                userId: candidate.user_id,
                generation: orderRow.generation,
                aggregateType: "PaperAccount",
                aggregateId: candidate.user_id,
                payload: { cashBalance: fillResult.account.cash, realisedPnl: fillResult.account.realisedPnl },
              }),
            ];

            await repos.write.insertOutboxEvents(outboxEvents);

            return {
              orderId: orderRow.id,
              fillId,
              symbol,
              fillPrice: fillPlan.fillPrice,
              quantity: fillPlan.quantity,
              status: nextOrderStatus as "FILLED" | "PARTIALLY_FILLED" | "REJECTED",
            };
          }
        );

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
