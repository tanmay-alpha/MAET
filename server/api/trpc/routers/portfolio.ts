/**
 * Portfolio tRPC Router
 * Portfolio management, positions, trades, and analytics
 */

import { router, protectedProcedure } from "../index";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { orders, fills, candles, watchlist } from "../../../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const portfolioRouter = router({
  // Get user's portfolio summary
  getPortfolioSummary: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        // Get all filled orders for the user
        const userOrders = await db.select().from(orders)
          .where(eq(orders.userId, ctx.userId));

        // Get all fills for the user's orders
        const userOrderIds = userOrders.map(o => o.id);
        let userFills: any[] = [];
        if (userOrderIds.length > 0) {
          userFills = await db.select().from(fills)
            .where(eq(fills.orderId, userOrderIds[0]));
          // For simplicity, get fills for all orders
          for (const orderId of userOrderIds) {
            const orderFills = await db.select().from(fills)
              .where(eq(fills.orderId, orderId));
            userFills = [...userFills, ...orderFills];
          }
        }

        // Calculate portfolio metrics
        let totalInvested = 0;
        let totalPnL = 0;
        let totalTrades = userFills.length;
        let winningTrades = 0;
        let losingTrades = 0;

        // Group fills by symbol to calculate P&L
        const symbolFills: Record<string, any[]> = {};
        userFills.forEach(fill => {
          const order = userOrders.find(o => o.id === fill.orderId);
          if (order) {
            const symbol = order.symbol;
            if (!symbolFills[symbol]) symbolFills[symbol] = [];
            symbolFills[symbol].push({ ...fill, side: order.side });
          }
        });

        // Calculate P&L per symbol
        Object.values(symbolFills).forEach(fills => {
          let buyQty = 0;
          let buyCost = 0;
          let sellQty = 0;
          let sellRevenue = 0;

          fills.forEach(fill => {
            if (fill.side === 'BUY') {
              buyQty += fill.qty;
              buyCost += fill.price * fill.qty + Number(fill.fee);
            } else {
              sellQty += fill.qty;
              sellRevenue += fill.price * fill.qty - Number(fill.fee);
            }
          });

          const matchedQty = Math.min(buyQty, sellQty);
          if (matchedQty > 0) {
            const avgBuy = buyCost / buyQty;
            const avgSell = sellRevenue / sellQty;
            const pnl = (avgSell - avgBuy) * matchedQty;
            totalPnL += pnl;
            if (pnl > 0) winningTrades++;
            else if (pnl < 0) losingTrades++;
          }
        });

        const totalInvestedValue = userFills
          .filter(f => {
            const order = userOrders.find(o => o.id === f.orderId);
            return order?.side === 'BUY';
          })
          .reduce((sum, f) => sum + f.price * f.qty, 0);

        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

        return {
          totalInvested: totalInvestedValue,
          currentValue: totalInvestedValue + totalPnL,
          totalPnL,
          totalPnLPercent: totalInvestedValue > 0 ? (totalPnL / totalInvestedValue) * 100 : 0,
          dayPnL: 0, // TODO: Calculate from previous close
          dayPnLPercent: 0,
          realizedPnL: totalPnL,
          unrealizedPnL: 0,
          totalReturns: totalInvestedValue > 0 ? (totalPnL / totalInvestedValue) * 100 : 0,
          winRate,
          totalTrades,
          winningTrades,
          losingTrades,
          largestWin: totalPnL > 0 ? totalPnL : 0,
          largestLoss: totalPnL < 0 ? totalPnL : 0,
          avgWin: winningTrades > 0 ? totalPnL / winningTrades : 0,
          avgLoss: losingTrades > 0 ? totalPnL / losingTrades : 0,
          profitFactor: losingTrades > 0 ? Math.abs(totalPnL / losingTrades) : totalPnL > 0 ? Infinity : 0,
          sharpeRatio: 0, // TODO: Calculate from daily returns
          maxDrawdown: 0, // TODO: Calculate from historical data
          beta: 1, // TODO: Calculate against benchmark
        };
      } catch (error) {
        console.error("Error fetching portfolio summary:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch portfolio summary",
        });
      }
    }),

  // Get all positions (derived from fills)
  getPositions: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userOrders = await db.select().from(orders)
          .where(eq(orders.userId, ctx.userId));

        const userOrderIds = userOrders.map(o => o.id);
        let userFills: any[] = [];
        if (userOrderIds.length > 0) {
          for (const orderId of userOrderIds) {
            const orderFills = await db.select().from(fills)
              .where(eq(fills.orderId, orderId));
            userFills = [...userFills, ...orderFills];
          }
        }

        // Group fills by symbol
        const symbolData: Record<string, {
          symbol: string;
          exchange: string;
          totalQty: number;
          avgPrice: number;
          totalCost: number;
          side: string;
        }> = {};

        userFills.forEach(fill => {
          const order = userOrders.find(o => o.id === fill.orderId);
          if (!order) return;

          const symbol = order.symbol;
          if (!symbolData[symbol]) {
            symbolData[symbol] = {
              symbol,
              exchange: order.exchange,
              totalQty: 0,
              avgPrice: 0,
              totalCost: 0,
              side: order.side,
            };
          }

          const data = symbolData[symbol];
          if (order.side === 'BUY') {
            data.totalQty += fill.qty;
            data.totalCost += fill.price * fill.qty;
          } else {
            data.totalQty -= fill.qty;
            data.totalCost -= fill.price * fill.qty;
          }
        });
        const symbols = Object.keys(symbolData);
        let latestCandles: any[] = [];
        if (symbols.length > 0) {
          latestCandles = await db.select().from(candles);
        }

        // Calculate average price and P&L
        const positions = Object.values(symbolData)
          .filter(pos => pos.totalQty > 0)
          .map(pos => {
            const avgPrice = pos.totalCost / pos.totalQty;
            // Get current price from latest candle
            const latestCandle = latestCandles.find(c => c.symbol === pos.symbol);

            return {
              id: crypto.randomUUID(),
              userId: ctx.userId,
              symbol: pos.symbol,
              exchange: pos.exchange,
              quantity: pos.totalQty,
              avgPrice,
              currentPrice: latestCandle?.close || avgPrice,
              type: pos.side === 'BUY' ? 'long' as const : 'short' as const,
              pnl: 0, // Calculated by frontend
              pnlPercent: 0,
              dayPnl: 0,
            };
          });

        return positions;
      } catch (error) {
        console.error("Error fetching positions:", error);
        return [];
      }
    }),

  // Get trade history
  getTradeHistory: protectedProcedure
    .input(z.object({
      limit: z.number().int().positive().max(100).default(50),
      offset: z.number().int().nonnegative().default(0),
      symbol: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const userOrders = await db.select().from(orders)
          .where(eq(orders.userId, ctx.userId))
          .orderBy(desc(orders.placedAt))
          .limit(input.limit)
          .offset(input.offset);

        // Get fills for these orders
        const trades = [];
        for (const order of userOrders) {
          const orderFills = await db.select().from(fills)
            .where(eq(fills.orderId, order.id));

          for (const fill of orderFills) {
            trades.push({
              id: fill.id,
              userId: ctx.userId,
              symbol: order.symbol,
              side: order.side.toLowerCase() as 'buy' | 'sell',
              quantity: fill.qty,
              price: Number(fill.price),
              fees: Number(fill.fee),
              pnl: 0, // TODO: Calculate realized P&L
              timestamp: fill.filledAt.toISOString(),
            });
          }
        }

        return trades;
      } catch (error) {
        console.error("Error fetching trade history:", error);
        return [];
      }
    }),

  // Get watchlist
  getWatchlist: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userWatchlist = await db.select().from(watchlist)
          .where(eq(watchlist.userId, ctx.userId));

        return userWatchlist.map(item => ({
          symbol: item.symbol,
          exchange: item.exchange,
          addedAt: item.createdAt.toISOString(),
        }));
      } catch (error) {
        console.error("Error fetching watchlist:", error);
        return [];
      }
    }),

  // Add to watchlist
  addToWatchlist: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      exchange: z.string().default("NSE"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await db.insert(watchlist).values({
          userId: ctx.userId,
          symbol: input.symbol.toUpperCase(),
          exchange: input.exchange.toUpperCase(),
          createdAt: new Date(),
        }).returning();

        return { success: true, symbol: input.symbol };
      } catch (error) {
        console.error("Error adding to watchlist:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add to watchlist",
        });
      }
    }),

  // Remove from watchlist
  removeFromWatchlist: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      exchange: z.string().default("NSE"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await db.delete(watchlist).where(
          and(
            eq(watchlist.userId, ctx.userId),
            eq(watchlist.symbol, input.symbol.toUpperCase()),
            eq(watchlist.exchange, input.exchange.toUpperCase())
          )
        );

        return { success: true, symbol: input.symbol };
      } catch (error) {
        console.error("Error removing from watchlist:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove from watchlist",
        });
      }
    }),

  // Get sector allocation
  getSectorAllocation: protectedProcedure
    .query(async ({ ctx }) => {
      // TODO: Implement sector classification and calculate allocation
      return [];
    }),

  // Get analytics
  getAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      // TODO: Calculate from trade history
      return {
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdown: 0,
        calmarRatio: 0,
        beta: 1,
        alpha: 0,
        winRate: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
      };
    }),
});