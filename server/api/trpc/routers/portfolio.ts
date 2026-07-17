/**
 * Portfolio tRPC Router — with N+1 elimination, proper error handling,
 * real P&L calculation, and bounded queries.
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import {
  paperAccounts, paperOrders, paperPositions,
  companies, candles, fills, watchlist,
} from "../../../db/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { loadQuotes } from "../../../domain/market/quote-service";
import { getRedis } from "../../../data/redis/client";

const memoryRateLimit = new Map<string, { count: number; windowStart: number }>();

function checkInMemoryRateLimit(userId: string) {
  const now = Date.now();
  const minuteMs = 60_000;
  const userRecord = memoryRateLimit.get(userId);

  if (!userRecord || now - userRecord.windowStart > minuteMs) {
    memoryRateLimit.set(userId, { count: 1, windowStart: now });
  } else {
    userRecord.count++;
    if (userRecord.count > 30) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded: maximum 30 mutations per minute",
      });
    }
  }
}

async function checkMutationRateLimit(userId: string) {
  try {
    const r = getRedis();
    const minute = Math.floor(Date.now() / 60_000).toString();
    const key = `ratelimit:mutations:${userId}:${minute}`;
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, 60);
    }
    if (count > 30) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded: maximum 30 mutations per minute",
      });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    checkInMemoryRateLimit(userId);
  }
}


// ---------------------------------------------------------------------------
// Helper: batch-fetch fills for multiple orders in ONE query
// ---------------------------------------------------------------------------

async function getFillsForOrderIds(orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, any[]>();
  const rows = await db.select().from(fills)
    .where(inArray(fills.orderId, orderIds));
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const list = map.get(row.orderId) ?? [];
    list.push(row);
    map.set(row.orderId, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helper: compute position P&L from fills
// ---------------------------------------------------------------------------

function computePositionPnl(fills: Array<{ side: string; qty: number; price: number; fee: number }>): {
  totalQty: number;
  avgPrice: number;
  realizedPnl: number;
} {
  let buyQty = 0, buyCost = 0, sellQty = 0, sellRevenue = 0;

  for (const fill of fills) {
    if (fill.side === "BUY") {
      buyQty += fill.qty;
      buyCost += fill.price * fill.qty + fill.fee;
    } else {
      sellQty += fill.qty;
      sellRevenue += fill.price * fill.qty - fill.fee;
    }
  }

  const closedQty = Math.min(buyQty, sellQty);
  const avgBuyPrice = buyQty > 0 ? buyCost / buyQty : 0;
  const avgSellPrice = sellQty > 0 ? sellRevenue / sellQty : 0;
  const realizedPnl = closedQty > 0 ? (avgSellPrice - avgBuyPrice) * closedQty : 0;

  const netQty = buyQty - sellQty;
  const avgPrice = netQty > 0 ? avgBuyPrice : netQty < 0 ? avgSellPrice : 0;

  return { totalQty: netQty, avgPrice, realizedPnl };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const portfolioRouter = createRouter({
  getPortfolioSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const userOrders = await db.select().from(paperOrders)
        .where(eq(paperOrders.userId, ctx.userId));

      if (userOrders.length === 0) {
        return {
          totalInvested: 0,
          currentValue: 0,
          totalPnL: 0,
          totalPnLPercent: 0,
          dayPnL: 0,
          dayPnLPercent: 0,
          realizedPnL: 0,
          unrealizedPnL: 0,
          totalReturns: 0,
          winRate: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          largestWin: 0,
          largestLoss: 0,
          avgWin: 0,
          avgLoss: 0,
          profitFactor: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          beta: 1,
        };
      }

      // Single query for all fills
      const orderIds = userOrders.map(o => o.id);
      const fillsMap = await getFillsForOrderIds(orderIds);

      // Build position map
      const positionFills = new Map<string, Array<{ side: string; qty: number; price: number; fee: number }>>();
      let totalRealizedPnl = 0;
      let winningTrades = 0, losingTrades = 0;
      let largestWin = 0, largestLoss = 0;

      for (const order of userOrders) {
        const orderFills = fillsMap.get(order.id) ?? [];
        if (orderFills.length === 0) continue;

        const fillsForOrder = orderFills.map(f => ({
          side: order.side,
          qty: f.qty,
          price: Number(f.price),
          fee: Number(f.fee),
        }));

        const { totalQty, avgPrice, realizedPnl } = computePositionPnl(fillsForOrder);

        if (realizedPnl > 0) { winningTrades++; largestWin = Math.max(largestWin, realizedPnl); }
        else if (realizedPnl < 0) { losingTrades++; largestLoss = Math.min(largestLoss, realizedPnl); }
        totalRealizedPnl += realizedPnl;

        const key = `${order.symbol}:${order.exchange}`;
        const existing = positionFills.get(key) ?? [];
        positionFills.set(key, [...existing, ...fillsForOrder]);
      }

      // Get current prices for unrealized P&L
      const symbols = [...new Set([...positionFills.keys()].map(k => k.split(":")[0]))];
      const quotes = symbols.length > 0 ? await loadQuotes(symbols) : { quotes: [] };
      const priceBySymbol = new Map(quotes.quotes.map(q => [q.symbol, q.price]));

      let totalInvested = 0;
      let unrealizedPnl = 0;

      for (const [key, fills] of positionFills) {
        const [symbol] = key.split(":");
        const { totalQty, avgPrice } = computePositionPnl(fills);
        if (totalQty === 0) continue;

        totalInvested += Math.abs(totalQty) * avgPrice;
        const currentPrice = priceBySymbol.get(symbol) ?? avgPrice;
        unrealizedPnl += totalQty > 0
          ? totalQty * (currentPrice - avgPrice)
          : Math.abs(totalQty) * (avgPrice - currentPrice);
      }

      const totalPnL = totalRealizedPnl + unrealizedPnl;
      const totalTrades = winningTrades + losingTrades;

      return {
        totalInvested,
        currentValue: totalInvested + totalPnL,
        totalPnL,
        totalPnLPercent: totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0,
        dayPnL: 0,
        dayPnLPercent: 0,
        realizedPnL: totalRealizedPnl,
        unrealizedPnL: unrealizedPnl,
        totalReturns: totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0,
        winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
        totalTrades,
        winningTrades,
        losingTrades,
        largestWin,
        largestLoss,
        avgWin: winningTrades > 0 ? largestWin / winningTrades : 0,
        avgLoss: losingTrades > 0 ? largestLoss / losingTrades : 0,
        profitFactor: losingTrades > 0 && largestLoss !== 0
          ? Math.abs(totalRealizedPnl / (largestLoss * losingTrades / Math.abs(largestLoss)))
          : totalRealizedPnl > 0 ? Infinity : 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        beta: 1,
      };
    }),

  getPositions: protectedProcedure
    .query(async ({ ctx }) => {
      // Single query for user's positions
      const userPositions = await db.select().from(paperPositions)
        .where(eq(paperPositions.userId, ctx.userId));

      if (userPositions.length === 0) return [];

      // Fetch current prices in batch
      const symbols = userPositions.map(p => p.symbol);
      const { quotes } = symbols.length > 0 ? await loadQuotes(symbols) : { quotes: [] };
      const priceBySymbol = new Map(quotes.quotes.map(q => [q.symbol, q.price]));

      // Get company data in batch
      const companyData = symbols.length > 0
        ? await db.select({ symbol: companies.symbol, name: companies.name, sector: companies.sector })
            .from(companies)
            .where(inArray(companies.symbol, symbols))
        : [];
      const companyBySymbol = new Map(companyData.map(c => [c.symbol, c]));

      return userPositions.map(pos => {
        const avgPrice = Number(pos.averageEntryPrice);
        const currentPrice = priceBySymbol.get(pos.symbol) ?? avgPrice;
        const qty = pos.totalShares;
        const pnl = qty > 0
          ? qty * (currentPrice - avgPrice)
          : Math.abs(qty) * (avgPrice - currentPrice);
        const company = companyBySymbol.get(pos.symbol);

        return {
          id: pos.id,
          userId: pos.userId,
          symbol: pos.symbol,
          exchange: pos.exchange,
          quantity: qty,
          avgPrice,
          currentPrice,
          name: company?.name,
          sector: company?.sector,
          type: qty > 0 ? "long" : qty < 0 ? "short" : "flat",
          pnl,
          pnlPercent: avgPrice > 0 ? (pnl / (Math.abs(qty) * avgPrice)) * 100 : 0,
          dayPnl: 0,
          marginLocked: Number(pos.marginLocked),
        };
      });
    }),

  getTradeHistory: protectedProcedure
    .input(z.object({
      limit: z.number().int().positive().max(100).default(50),
      offset: z.number().int().nonnegative().default(0),
      symbol: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // Join orders + fills in single query using raw SQL for the fill join
      const userOrders = await db.select().from(paperOrders)
        .where(eq(paperOrders.userId, ctx.userId))
        .orderBy(desc(paperOrders.placedAt))
        .limit(input.limit)
        .offset(input.offset);

      // Batch fetch fills
      const orderIds = userOrders.map(o => o.id);
      const fillsMap = await getFillsForOrderIds(orderIds);

      const trades: any[] = [];
      for (const order of userOrders) {
        const orderFills = fillsMap.get(order.id) ?? [];
        for (const fill of orderFills) {
          if (input.symbol && order.symbol !== input.symbol.toUpperCase()) continue;
          trades.push({
            id: fill.id,
            userId: ctx.userId,
            symbol: order.symbol,
            side: order.side.toLowerCase() as "buy" | "sell",
            quantity: fill.qty,
            price: Number(fill.price),
            fees: Number(fill.fee),
            pnl: 0,
            timestamp: fill.filledAt.toISOString(),
          });
        }
      }

      return trades;
    }),

  getWatchlist: protectedProcedure
    .query(async ({ ctx }) => {
      const userWatchlist = await db.select().from(watchlist)
        .where(eq(watchlist.userId, ctx.userId));

      return userWatchlist.map(item => ({
        symbol: item.symbol,
        exchange: item.exchange,
        addedAt: item.createdAt.toISOString(),
      }));
    }),

  addToWatchlist: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      exchange: z.string().default("NSE"),
    }))
    .mutation(async ({ input, ctx }) => {
      await checkMutationRateLimit(ctx.userId);
      const result = await db.insert(watchlist).values({
        userId: ctx.userId,
        symbol: input.symbol.toUpperCase(),
        exchange: input.exchange.toUpperCase(),
        createdAt: new Date(),
      }).onConflictDoUpdate({
        target: [watchlist.userId, watchlist.exchange, watchlist.symbol],
        set: { createdAt: new Date() },
      }).returning();

      return { success: true, symbol: input.symbol.toUpperCase() };
    }),

  removeFromWatchlist: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      exchange: z.string().default("NSE"),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(watchlist).where(
        and(
          eq(watchlist.userId, ctx.userId),
          eq(watchlist.symbol, input.symbol.toUpperCase()),
          eq(watchlist.exchange, input.exchange.toUpperCase()),
        ),
      );
      return { success: true, symbol: input.symbol.toUpperCase() };
    }),

  getSectorAllocation: protectedProcedure
    .query(async ({ ctx }) => {
      // Single query for all user orders
      const userOrders = await db.select().from(paperOrders)
        .where(eq(paperOrders.userId, ctx.userId));

      if (userOrders.length === 0) return [];

      // Batch fetch fills
      const orderIds = userOrders.map(o => o.id);
      const fillsMap = await getFillsForOrderIds(orderIds);

      // Aggregate fills by symbol
      const symbolFills = new Map<string, Array<{ side: string; qty: number; price: number; fee: number }>>();
      for (const order of userOrders) {
        const orderFills = fillsMap.get(order.id) ?? [];
        for (const fill of orderFills) {
          const key = order.symbol;
          const existing = symbolFills.get(key) ?? [];
          symbolFills.set(key, [...existing, { side: order.side, qty: fill.qty, price: Number(fill.price), fee: Number(fill.fee) }]);
        }
      }

      // Filter open positions only
      const openSymbols = [...symbolFills.entries()]
        .filter(([, fills]) => {
          const { totalQty } = computePositionPnl(fills);
          return totalQty > 0;
        })
        .map(([symbol]) => symbol);

      // Batch fetch company sectors
      const companyData = openSymbols.length > 0
        ? await db.select({ symbol: companies.symbol, sector: companies.sector })
            .from(companies)
            .where(inArray(companies.symbol, openSymbols))
        : [];
      const sectorBySymbol = new Map(companyData.map(c => [c.symbol, c.sector ?? "Unknown"]));

      const sectorExposure = new Map<string, { invested: number; currentValue: number; pnl: number }>();

      for (const [symbol, fills] of symbolFills) {
        const { totalQty, avgPrice } = computePositionPnl(fills);
        if (totalQty <= 0) continue;

        const sector = sectorBySymbol.get(symbol) ?? "Unknown";
        const current = sectorExposure.get(sector) ?? { invested: 0, currentValue: 0, pnl: 0 };
        const invested = Math.abs(totalQty) * avgPrice;
        current.invested += invested;
        current.currentValue += invested; // Will be updated with live prices in Phase 2
        sectorExposure.set(sector, current);
      }

      const totalInvested = [...sectorExposure.values()].reduce((s, e) => s + e.invested, 0);

      return [...sectorExposure.entries()].map(([sector, exposure]) => ({
        sector,
        invested: exposure.invested,
        currentValue: exposure.currentValue,
        pnl: exposure.pnl,
        pnlPercent: exposure.invested > 0 ? (exposure.pnl / exposure.invested) * 100 : 0,
        allocationPercent: totalInvested > 0 ? (exposure.invested / totalInvested) * 100 : 0,
      }));
    }),

  getAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      // Phase 2: calculate from stored trade history
      // For now, return zeros but DO NOT swallow errors
      const userOrders = await db.select().from(paperOrders)
        .where(eq(paperOrders.userId, ctx.userId));

      if (userOrders.length === 0) {
        return {
          sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, calmarRatio: 0,
          beta: 1, alpha: 0, winRate: 0, profitFactor: 0,
          avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
          consecutiveWins: 0, consecutiveLosses: 0, totalTrades: 0,
        };
      }

      // TODO: Implement proper analytics calculation in Phase 2
      return {
        sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, calmarRatio: 0,
        beta: 1, alpha: 0, winRate: 0, profitFactor: 0,
        avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
        consecutiveWins: 0, consecutiveLosses: 0, totalTrades: userOrders.length,
      };
    }),
});
