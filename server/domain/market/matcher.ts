import { eq, and, or, sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import {
  paperAccounts,
  paperOrders,
  paperPositions,
  companies,
  fundamentals,
} from "../../db/schema";
import { calculateSlippage } from "./slippage";
import { quoteStore } from "./quote-store";

export interface MatchingReceipt {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  slippageApplied: number;
  transactionFee: number;
  executionTimestamp: string;
  status: "FILLED" | "REJECTED";
  rejectReason?: string;
  updatedMarginLocked: number;
  cashBalance: number;
}

// In-memory cache for company metadata to avoid DB roundtrips on every tick
interface CompanyMetadata {
  marketCapBucket?: string;
  avgVolume?: number;
}

const metadataCache = new Map<string, CompanyMetadata>();

async function getCompanyMetadata(symbol: string): Promise<CompanyMetadata> {
  let cached = metadataCache.get(symbol);
  if (!cached) {
    try {
      const results = await db
        .select({
          marketCapBucket: companies.marketCapBucket,
          avgVolume: fundamentals.average20DayVolume,
        })
        .from(companies)
        .leftJoin(fundamentals, eq(companies.id, fundamentals.companyId))
        .where(eq(companies.symbol, symbol))
        .limit(1);

      if (results.length > 0) {
        cached = {
          marketCapBucket: results[0].marketCapBucket,
          avgVolume: results[0].avgVolume || undefined,
        };
      } else {
        cached = {};
      }
      metadataCache.set(symbol, cached);
    } catch (e) {
      console.error(`Failed to fetch company metadata for ${symbol}:`, e);
      return {};
    }
  }
  return cached;
}

// In-memory queue / mutex locks per symbol to process ticks sequentially
const symbolLocks = new Map<string, Promise<void>>();

async function runLocked<T>(symbol: string, fn: () => Promise<T>): Promise<T> {
  const previous = symbolLocks.get(symbol) || Promise.resolve();
  let resolveLock: () => void;
  const next = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  symbolLocks.set(symbol, next);
  await previous;
  try {
    return await fn();
  } finally {
    resolveLock!();
    if (symbolLocks.get(symbol) === next) {
      symbolLocks.delete(symbol);
    }
  }
}

/**
 * Hot path called by Angel One WebSocket when a tick is received.
 * Coordinates order matching, bracket order triggers, slippage, and margin.
 */
export async function onTick(
  symbol: string,
  ltp: number,
  bid: number,
  ask: number,
  volume: number
): Promise<MatchingReceipt[]> {
  return runLocked(symbol, async () => {
    const meta = await getCompanyMetadata(symbol);
    const receipts: MatchingReceipt[] = [];

    // Ensure bid and ask default to ltp if they are not provided (or 0)
    const executionBid = bid > 0 ? bid : ltp;
    const executionAsk = ask > 0 ? ask : ltp;

    // 1. First run the liquidation check for all users holding an active position in this symbol
    const activePositions = await db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.symbol, symbol));

    for (const pos of activePositions) {
      try {
        await db.transaction(async (tx) => {
          const [account] = await tx
            .select()
            .from(paperAccounts)
            .where(eq(paperAccounts.userId, pos.userId))
            .for("update");

          if (!account) return;

          // Select and lock all positions of this user to find current total unrealized PnL
          const userPositions = await tx
            .select()
            .from(paperPositions)
            .where(eq(paperPositions.userId, pos.userId))
            .for("update");

          let totalUnrealizedPnl = 0;
          for (const p of userPositions) {
            if (p.symbol === symbol) {
              const shares = p.totalShares;
              const avgPrice = Number(p.averageEntryPrice);
              const pnl =
                shares > 0
                  ? shares * (ltp - avgPrice)
                  : Math.abs(shares) * (avgPrice - ltp);
              totalUnrealizedPnl += pnl;
            } else {
              totalUnrealizedPnl += Number(p.unrealizedPnl);
            }
          }

          const cashBalance = Number(account.cashBalance);
          const allocatedMargin = Number(account.allocatedMargin);
          const maintenanceMargin = Number(account.maintenanceMargin);
          const equity = cashBalance + totalUnrealizedPnl;

          if (equity < maintenanceMargin) {
            // Trigger auto-liquidation
            await liquidateAccount(tx, pos.userId, symbol, ltp);
          } else {
            // Recalculate and update the unrealized P&L of the position in the db
            const currentPosition = userPositions.find((p) => p.symbol === symbol);
            if (currentPosition) {
              const shares = currentPosition.totalShares;
              const avgPrice = Number(currentPosition.averageEntryPrice);
              const currentPnl =
                shares > 0
                  ? shares * (ltp - avgPrice)
                  : Math.abs(shares) * (avgPrice - ltp);
              
              await tx
                .update(paperPositions)
                .set({
                  unrealizedPnl: currentPnl.toString(),
                  updatedAt: new Date(),
                })
                .where(eq(paperPositions.id, currentPosition.id));
            }
          }
        });
      } catch (err) {
        console.error(`Liquidation check transaction error for user ${pos.userId}:`, err);
      }
    }

    // 2. Fetch pending paper orders for this symbol
    const pendingOrders = await db
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.symbol, symbol),
          or(
            eq(paperOrders.status, "PENDING"),
            eq(paperOrders.status, "TRIGGER_PENDING"),
            eq(paperOrders.status, "PARTIALLY_FILLED")
          )
        )
      );

    for (const order of pendingOrders) {
      let isTriggered = false;
      let isMatched = false;
      let fillPrice = 0;
      let slippage = 0;

      // Trailing stop trigger check
      let trailingStopTriggered = false;
      if (order.trailingDistance && Number(order.trailingDistance) > 0) {
        const dist = Number(order.trailingDistance);
        const isPercent = !!order.isTrailingPercent;

        if (order.side === "SELL") {
          let hwm = order.trailingHwm ? Number(order.trailingHwm) : null;
          if (hwm === null || hwm === 0 || ltp > hwm) {
            hwm = ltp;
            const stopPrice = isPercent
              ? hwm * (1 - dist / 100)
              : hwm - dist;

            await db
              .update(paperOrders)
              .set({
                trailingHwm: hwm.toString(),
                stopPrice: stopPrice.toString(),
                updatedAt: new Date(),
              })
              .where(eq(paperOrders.id, order.id));

            order.trailingHwm = hwm.toString();
            order.stopPrice = stopPrice.toString();
          }

          const currentStopPrice = order.stopPrice ? Number(order.stopPrice) : 0;
          if (ltp <= currentStopPrice) {
            trailingStopTriggered = true;
          }
        } else if (order.side === "BUY") {
          let lwm = order.trailingLwm ? Number(order.trailingLwm) : null;
          if (lwm === null || lwm === 0 || ltp < lwm) {
            lwm = ltp;
            const stopPrice = isPercent
              ? lwm * (1 + dist / 100)
              : lwm + dist;

            await db
              .update(paperOrders)
              .set({
                trailingLwm: lwm.toString(),
                stopPrice: stopPrice.toString(),
                updatedAt: new Date(),
              })
              .where(eq(paperOrders.id, order.id));

            order.trailingLwm = lwm.toString();
            order.stopPrice = stopPrice.toString();
          }

          const currentStopPrice = order.stopPrice ? Number(order.stopPrice) : 0;
          if (ltp >= currentStopPrice) {
            trailingStopTriggered = true;
          }
        }
      }

      if (trailingStopTriggered) {
        order.status = "PENDING";
        isTriggered = true;
        await db
          .update(paperOrders)
          .set({
            status: "PENDING",
            type: "MARKET",
            updatedAt: new Date(),
          })
          .where(eq(paperOrders.id, order.id));
        order.type = "MARKET";
      }

      if (order.status === "TRIGGER_PENDING" && !trailingStopTriggered) {
        // Trigger verification for STOP_LOSS_LIMIT orders
        if (order.type === "STOP_LOSS_LIMIT" && order.stopPrice) {
          const stopPriceNum = Number(order.stopPrice);
          if (order.side === "BUY" && ltp >= stopPriceNum) {
            isTriggered = true;
          } else if (order.side === "SELL" && ltp <= stopPriceNum) {
            isTriggered = true;
          }
        }

        // If triggered, update status to PENDING
        if (isTriggered) {
          const stopPriceNum = order.stopPrice ? Number(order.stopPrice) : 0;
          // GAP-DOWN PROTECTION: Convert to MARKET order if price gaps beyond target trigger price
          const isGap = order.side === "BUY" ? ltp > stopPriceNum : ltp < stopPriceNum;
          const targetType = isGap ? "MARKET" : "LIMIT";

          await db
            .update(paperOrders)
            .set({ 
              status: "PENDING", 
              type: targetType, 
              rejectReason: isGap ? "Stop loss limit gap-down fallback applied" : null,
              updatedAt: new Date() 
            })
            .where(eq(paperOrders.id, order.id));

          order.status = "PENDING";
          order.type = targetType;
        }
      }

      if (order.status === "PENDING" || order.status === "PARTIALLY_FILLED") {
        if (order.type === "MARKET") {
          isMatched = true;
          // Apply slippage penalty for market orders
          slippage = calculateSlippage(
            ltp,
            order.qty,
            meta.avgVolume,
            meta.marketCapBucket
          );
          if (order.side === "BUY") {
            fillPrice = executionAsk + slippage;
          } else {
            fillPrice = Math.max(0.05, executionBid - slippage);
          }
        } else if (order.type === "LIMIT") {
          const limitPriceNum = Number(order.limitPrice);
          if (order.side === "BUY" && executionAsk <= limitPriceNum) {
            isMatched = true;
            fillPrice = limitPriceNum;
          } else if (order.side === "SELL" && executionBid >= limitPriceNum) {
            isMatched = true;
            fillPrice = limitPriceNum;
          }
        } else if (order.type === "STOP_LOSS_LIMIT" && isTriggered) {
          const limitPriceNum = Number(order.limitPrice);
          slippage = calculateSlippage(
            ltp,
            order.qty,
            meta.avgVolume,
            meta.marketCapBucket
          );
          if (order.side === "BUY" && executionAsk <= limitPriceNum) {
            isMatched = true;
            fillPrice = limitPriceNum + slippage;
          } else if (order.side === "SELL" && executionBid >= limitPriceNum) {
            isMatched = true;
            fillPrice = Math.max(0.05, limitPriceNum - slippage);
          }
        }
      }

      if (!isMatched) continue;

      // Extract remaining quantity to fill
      const remainingQty = order.qty - (order.filledQty || 0);
      if (remainingQty <= 0) continue;

      // PARTIAL FILLS: Cap the fill quantity in this tick by the tick's available volume
      const availableVolume = volume > 0 ? volume : 1000;
      const fillQty = (order.type === "LIMIT" || order.type === "STOP_LOSS_LIMIT")
        ? Math.min(remainingQty, availableVolume)
        : remainingQty;

      if (fillQty <= 0) continue;

      // 3. Execute matching transaction
      try {
        const receipt = await db.transaction(async (tx) => {
          // Select and lock the account
          const [account] = await tx
            .select()
            .from(paperAccounts)
            .where(eq(paperAccounts.userId, order.userId))
            .for("update");

          if (!account) {
            throw new Error(`Paper account not found for user ${order.userId}`);
          }

          if (account.isLocked) {
            await tx
              .update(paperOrders)
              .set({
                status: "REJECTED",
                rejectReason: "Account locked due to margin call",
                updatedAt: new Date(),
              })
              .where(eq(paperOrders.id, order.id));

            return {
              orderId: order.id,
              symbol,
              side: order.side,
              qty: fillQty,
              price: 0,
              slippageApplied: 0,
              transactionFee: 0,
              executionTimestamp: new Date().toISOString(),
              status: "REJECTED" as const,
              rejectReason: "Account locked due to margin call",
              updatedMarginLocked: Number(account.allocatedMargin),
              cashBalance: Number(account.cashBalance),
            };
          }

          // Select and lock current position for this symbol
          const [position] = await tx
            .select()
            .from(paperPositions)
            .where(
              and(
                eq(paperPositions.userId, order.userId),
                eq(paperPositions.symbol, symbol),
                eq(paperPositions.exchange, order.exchange)
              )
            )
            .for("update");

          // Fetch all other positions for unrealized PnL calculation
          const allPositions = await tx
            .select()
            .from(paperPositions)
            .where(eq(paperPositions.userId, order.userId));

          let otherUnrealizedPnl = 0;
          for (const pos of allPositions) {
            if (pos.symbol !== symbol) {
              otherUnrealizedPnl += Number(pos.unrealizedPnl);
            }
          }

          const oldShares = position ? position.totalShares : 0;
          const oldAvgPrice = position ? Number(position.averageEntryPrice) : 0;
          const oldMarginLocked = position ? Number(position.marginLocked) : 0;

          // Transaction fees: NSE charges 0.00345%
          const transactionFee = fillPrice * fillQty * 0.0000345;

          let newShares = oldShares;
          let newAvgPrice = oldAvgPrice;
          let realizedPnl = 0;

          if (order.side === "BUY") {
            newShares = oldShares + fillQty;
          } else {
            newShares = oldShares - fillQty;
          }

          // Calculate realized P&L and average price using actual fillQty
          if (oldShares === 0) {
            newAvgPrice = fillPrice;
          } else if (Math.sign(oldShares) === Math.sign(newShares)) {
            newAvgPrice =
              (Math.abs(oldShares) * oldAvgPrice + fillQty * fillPrice) /
              Math.abs(newShares);
          } else {
            const closedQty = Math.min(fillQty, Math.abs(oldShares));
            const direction = Math.sign(oldShares);

            if (direction > 0) {
              realizedPnl = closedQty * (fillPrice - oldAvgPrice);
            } else {
              realizedPnl = closedQty * (oldAvgPrice - fillPrice);
            }

            const remainderQty = fillQty - closedQty;
            if (remainderQty > 0) {
              newShares = direction > 0 ? -remainderQty : remainderQty;
              newAvgPrice = fillPrice;
            } else {
              newAvgPrice = oldAvgPrice;
            }
          }

          const newUnrealizedPnl =
            newShares === 0
              ? 0
              : newShares > 0
              ? newShares * (ltp - newAvgPrice)
              : Math.abs(newShares) * (newAvgPrice - ltp);

          const leverage = account.leverageFactor;
          const newMarginLocked =
            newShares === 0 ? 0 : (Math.abs(newShares) * newAvgPrice) / leverage;

          const marginIncrement = newMarginLocked - oldMarginLocked;

          // Margin check
          const cashBalance = Number(account.cashBalance);
          const currentAllocatedMargin = Number(account.allocatedMargin);
          const totalUnrealizedPnl = otherUnrealizedPnl + newUnrealizedPnl;
          const equity = cashBalance + totalUnrealizedPnl;
          const freeMargin = equity - currentAllocatedMargin;

          if (marginIncrement > 0 && freeMargin < marginIncrement) {
            await tx
              .update(paperOrders)
              .set({
                status: "REJECTED",
                rejectReason: "Insufficient margin",
                updatedAt: new Date(),
              })
              .where(eq(paperOrders.id, order.id));

            return {
              orderId: order.id,
              symbol,
              side: order.side,
              qty: fillQty,
              price: fillPrice,
              slippageApplied: slippage,
              transactionFee,
              executionTimestamp: new Date().toISOString(),
              status: "REJECTED" as const,
              rejectReason: "Insufficient margin",
              updatedMarginLocked: currentAllocatedMargin,
              cashBalance,
            };
          }

          // Update position
          if (newShares === 0) {
            await tx
              .delete(paperPositions)
              .where(
                and(
                  eq(paperPositions.userId, order.userId),
                  eq(paperPositions.symbol, symbol),
                  eq(paperPositions.exchange, order.exchange)
                )
              );
          } else {
            await tx
              .insert(paperPositions)
              .values({
                id: position?.id || crypto.randomUUID(),
                userId: order.userId,
                symbol,
                exchange: order.exchange,
                averageEntryPrice: newAvgPrice.toString(),
                totalShares: newShares,
                realizedPnl: ((position ? Number(position.realizedPnl) : 0) + realizedPnl).toString(),
                unrealizedPnl: newUnrealizedPnl.toString(),
                marginLocked: newMarginLocked.toString(),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  paperPositions.userId,
                  paperPositions.symbol,
                  paperPositions.exchange,
                ],
                set: {
                  averageEntryPrice: newAvgPrice.toString(),
                  totalShares: newShares,
                  realizedPnl: ((position ? Number(position.realizedPnl) : 0) + realizedPnl).toString(),
                  unrealizedPnl: newUnrealizedPnl.toString(),
                  marginLocked: newMarginLocked.toString(),
                  updatedAt: new Date(),
                },
              });
          }

          const updatedAllocatedMargin = currentAllocatedMargin + marginIncrement;
          const updatedMaintenanceMargin = updatedAllocatedMargin * 0.8;

          // Update account
          const newCashBalance = cashBalance + realizedPnl - transactionFee;
          await tx
            .update(paperAccounts)
            .set({
              cashBalance: newCashBalance.toString(),
              allocatedMargin: updatedAllocatedMargin.toString(),
              maintenanceMargin: updatedMaintenanceMargin.toString(),
              updatedAt: new Date(),
            })
            .where(eq(paperAccounts.userId, order.userId));

          // Set order status based on fill completion
          const totalFilledQty = (order.filledQty || 0) + fillQty;
          const isFullyFilled = totalFilledQty === order.qty;
          const newStatus = isFullyFilled ? "FILLED" : "PARTIALLY_FILLED";
          const accumulatedFee = Number(order.transactionFee || 0) + transactionFee;

          // Compute new weighted average fill price
          const existingFillVal = (order.filledQty || 0) * Number(order.averageFillPrice || 0);
          const newAvgFillPrice = (existingFillVal + fillQty * fillPrice) / totalFilledQty;

          await tx
            .update(paperOrders)
            .set({
              status: newStatus,
              filledQty: totalFilledQty,
              averageFillPrice: newAvgFillPrice.toString(),
              slippageApplied: slippage.toString(),
              transactionFee: accumulatedFee.toString(),
              filledAt: isFullyFilled ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(eq(paperOrders.id, order.id));

          // 4. Bracket order chain management - only triggers when fully filled
          if (
            isFullyFilled &&
            ((order.takeProfitPrice && Number(order.takeProfitPrice) > 0) ||
             (order.stopLossPrice && Number(order.stopLossPrice) > 0))
          ) {
            const childSide = order.side === "BUY" ? "SELL" : "BUY";

            if (order.takeProfitPrice && Number(order.takeProfitPrice) > 0) {
              await tx.insert(paperOrders).values({
                id: crypto.randomUUID(),
                userId: order.userId,
                parentOrderId: order.id,
                symbol,
                exchange: order.exchange,
                side: childSide,
                type: "LIMIT",
                status: "PENDING",
                executionType: "GOOD_TILL_CANCELLED",
                qty: order.qty,
                limitPrice: order.takeProfitPrice,
              });
            }

            if (order.stopLossPrice && Number(order.stopLossPrice) > 0) {
              await tx.insert(paperOrders).values({
                id: crypto.randomUUID(),
                userId: order.userId,
                parentOrderId: order.id,
                symbol,
                exchange: order.exchange,
                side: childSide,
                type: "STOP_LOSS_LIMIT",
                status: "TRIGGER_PENDING",
                executionType: "GOOD_TILL_CANCELLED",
                qty: order.qty,
                stopPrice: order.stopLossPrice,
                limitPrice: order.stopLossPrice,
              });
            }
          }

          // If this is a child order, manage the sibling order (OCO) with row locks
          if (order.parentOrderId) {
            const siblings = await tx
              .select()
              .from(paperOrders)
              .where(
                and(
                  eq(paperOrders.parentOrderId, order.parentOrderId),
                  sql`${paperOrders.id} != ${order.id}`
                )
              )
              .for("update");

            for (const sibling of siblings) {
              if (
                sibling.status === "PENDING" ||
                sibling.status === "TRIGGER_PENDING"
              ) {
                if (isFullyFilled) {
                  // Fully filled -> Cancel sibling completely
                  await tx
                    .update(paperOrders)
                    .set({
                      status: "CANCELLED",
                      updatedAt: new Date(),
                    })
                    .where(eq(paperOrders.id, sibling.id));
                } else {
                  // Partially filled -> Reduce sibling quantity by fillQty
                  const newSiblingQty = Math.max(1, sibling.qty - fillQty);
                  await tx
                    .update(paperOrders)
                    .set({
                      qty: newSiblingQty,
                      updatedAt: new Date(),
                    })
                    .where(eq(paperOrders.id, sibling.id));
                }
              }
            }
          }

          // 5. Margin Liquidation Check
          const freshEquity = newCashBalance + totalUnrealizedPnl;
          if (freshEquity < updatedMaintenanceMargin) {
            await liquidateAccount(tx, order.userId, symbol, ltp);
          }

          return {
            orderId: order.id,
            symbol,
            side: order.side,
            qty: fillQty,
            price: fillPrice,
            slippageApplied: slippage,
            transactionFee,
            executionTimestamp: new Date().toISOString(),
            status: newStatus as any,
            updatedMarginLocked: newShares === 0 ? 0 : updatedAllocatedMargin,
            cashBalance: newCashBalance,
          };
        });

        if (receipt) {
          receipts.push(receipt);
        }
      } catch (err) {
        console.error(`Matching transaction error for order ${order.id}:`, err);
      }
    }

    return receipts;
  });
}

/**
 * Liquidation of all open positions in the database for the given user.
 */
export async function liquidateAccount(
  tx: any,
  userId: string,
  triggeredBySymbol?: string,
  ltp?: number
) {
  console.warn(`[MARGIN CALL] Auto-liquidating account for user ${userId}`);

  // Cancel all pending/trigger pending orders for this user
  await tx
    .update(paperOrders)
    .set({
      status: "CANCELLED",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paperOrders.userId, userId),
        or(
          eq(paperOrders.status, "PENDING"),
          eq(paperOrders.status, "TRIGGER_PENDING"),
          eq(paperOrders.status, "PARTIALLY_FILLED")
        )
      )
    );

  // Fetch all open positions
  const openPositions = await tx
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.userId, userId))
    .for("update");

  let totalRealizedPnl = 0;
  let totalFees = 0;

  for (const pos of openPositions) {
    const qty = pos.totalShares;
    if (qty === 0) continue;

    const side = qty > 0 ? "SELL" : "BUY";
    const absQty = Math.abs(qty);
    const avgPrice = Number(pos.averageEntryPrice);

    // Resolve current price from quoteStore or fallback
    const tick = quoteStore.get(pos.symbol);
    const price = tick
      ? tick.price
      : triggeredBySymbol && pos.symbol === triggeredBySymbol && ltp
      ? ltp
      : Number(pos.averageEntryPrice);

    const meta = await getCompanyMetadata(pos.symbol);
    const slippage = calculateSlippage(
      price,
      absQty,
      meta.avgVolume,
      meta.marketCapBucket
    );

    const fillPrice =
      side === "BUY" ? price + slippage : Math.max(0.05, price - slippage);
    const fee = fillPrice * absQty * 0.0000345;

    const realizedPnl =
      qty > 0 ? absQty * (fillPrice - avgPrice) : absQty * (avgPrice - fillPrice);

    totalRealizedPnl += realizedPnl;
    totalFees += fee;

    await tx.insert(paperOrders).values({
      id: crypto.randomUUID(),
      userId,
      symbol: pos.symbol,
      exchange: pos.exchange,
      side,
      type: "MARKET",
      status: "FILLED",
      executionType: "GOOD_TILL_CANCELLED",
      qty: absQty,
      filledQty: absQty,
      averageFillPrice: fillPrice.toString(),
      slippageApplied: slippage.toString(),
      transactionFee: fee.toString(),
      placedAt: new Date(),
      filledAt: new Date(),
      updatedAt: new Date(),
    });

    await tx
      .delete(paperPositions)
      .where(eq(paperPositions.id, pos.id));
  }

  // Update paper account - lock it and clear margin
  const [acc] = await tx
    .select()
    .from(paperAccounts)
    .where(eq(paperAccounts.userId, userId))
    .for("update");

  if (acc) {
    let newCash = Number(acc.cashBalance) + totalRealizedPnl - totalFees;
    
    // GAP-DOWN DEBT FLOOR: Cap the realized liquidation cash at 0 to prevent negative balance
    if (newCash < 0) {
      newCash = 0;
    }

    await tx
      .update(paperAccounts)
      .set({
        cashBalance: newCash.toString(),
        allocatedMargin: "0.0000",
        maintenanceMargin: "0.0000",
        isLocked: true,
        updatedAt: new Date(),
      })
      .where(eq(paperAccounts.userId, userId));
  }
}
