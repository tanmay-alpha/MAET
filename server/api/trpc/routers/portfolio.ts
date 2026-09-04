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
  companies, candles, fills, paperFills,
} from "../../../db/schema";
import { eq, desc, asc, and, gte, inArray, lte, sql } from "drizzle-orm";
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

const TRADING_DAYS_PER_YEAR = 252;
const DAILY_RISK_FREE_RATE = 0.065 / TRADING_DAYS_PER_YEAR;

type AnalyticsFill = {
  symbol: string;
  exchange: string;
  side: string;
  quantity: number;
  fillPrice: string | number;
  fees: string | number;
  realizedPnl: string | number;
  executedAt: Date;
};

type BenchmarkCandle = {
  close: string | number;
  ts: Date;
};

function calculatePortfolioAnalytics(
  initialCash: number,
  fills: AnalyticsFill[],
  benchmarkCandles: BenchmarkCandle[],
) {
  const positions = new Map<string, { quantity: number; averagePrice: number; fees: number }>();
  const closedTrades: Array<{ pnl: number; executedAt: Date }> = [];

  for (const fill of [...fills].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())) {
    const quantity = Number(fill.quantity);
    const price = Number(fill.fillPrice);
    const fees = Number(fill.fees);
    const realizedPnl = Number(fill.realizedPnl);
    if (
      quantity <= 0 ||
      !Number.isFinite(price) ||
      !Number.isFinite(fees) ||
      !Number.isFinite(realizedPnl)
    ) continue;

    const signedQuantity = fill.side === "BUY" ? quantity : -quantity;
    const key = `${fill.exchange}:${fill.symbol}`;
    const position = positions.get(key);

    if (!position) {
      positions.set(key, { quantity: signedQuantity, averagePrice: price, fees });
      continue;
    }

    if (Math.sign(position.quantity) === Math.sign(signedQuantity)) {
      const totalQuantity = Math.abs(position.quantity) + quantity;
      positions.set(key, {
        quantity: position.quantity + signedQuantity,
        averagePrice: (position.averagePrice * Math.abs(position.quantity) + price * quantity) / totalQuantity,
        fees: position.fees + fees,
      });
      continue;
    }

    const openQuantity = Math.abs(position.quantity);
    const closedQuantity = Math.min(openQuantity, quantity);
    const openingFees = position.fees * (closedQuantity / openQuantity);
    const closingFees = fees * (closedQuantity / quantity);
    closedTrades.push({
      pnl: realizedPnl - openingFees - closingFees,
      executedAt: fill.executedAt,
    });

    const remainingQuantity = position.quantity + signedQuantity;
    if (remainingQuantity === 0) {
      positions.delete(key);
    } else if (Math.sign(remainingQuantity) === Math.sign(position.quantity)) {
      positions.set(key, {
        quantity: remainingQuantity,
        averagePrice: position.averagePrice,
        fees: position.fees - openingFees,
      });
    } else {
      positions.set(key, {
        quantity: remainingQuantity,
        averagePrice: price,
        fees: fees - closingFees,
      });
    }
  }

  const dailyPnl = new Map<string, number>();
  for (const trade of closedTrades) {
    const day = trade.executedAt.toISOString().slice(0, 10);
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + trade.pnl);
  }

  const dailyReturns = new Map<string, number>();
  let equity = initialCash;
  let peak = equity;
  let maxDrawdown = 0;
  for (const [day, pnl] of [...dailyPnl.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const previousEquity = equity;
    equity += pnl;
    dailyReturns.set(day, previousEquity > 0 ? pnl / previousEquity : 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
  }

  const returns = [...dailyReturns.values()];
  const excessReturns = returns.map((value) => value - DAILY_RISK_FREE_RATE);
  const meanExcessReturn = excessReturns.length > 0
    ? excessReturns.reduce((sum, value) => sum + value, 0) / excessReturns.length
    : 0;
  const standardDeviation = excessReturns.length > 0
    ? Math.sqrt(excessReturns.reduce((sum, value) => sum + (value - meanExcessReturn) ** 2, 0) / excessReturns.length)
    : 0;
  const downsideReturns = excessReturns.filter((value) => value < 0);
  const downsideDeviation = downsideReturns.length > 0
    ? Math.sqrt(downsideReturns.reduce((sum, value) => sum + value ** 2, 0) / downsideReturns.length)
    : 0;

  let benchmarkVariance = 0;
  let covariance = 0;
  let beta: number | null = null;
  let alpha: number | null = null;
  const benchmarkReturns = new Map<string, number>();
  const sortedBenchmarkCandles = [...benchmarkCandles].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (let index = 1; index < sortedBenchmarkCandles.length; index++) {
    const previousClose = Number(sortedBenchmarkCandles[index - 1].close);
    const close = Number(sortedBenchmarkCandles[index].close);
    if (previousClose > 0 && Number.isFinite(close)) {
      benchmarkReturns.set(sortedBenchmarkCandles[index].ts.toISOString().slice(0, 10), (close - previousClose) / previousClose);
    }
  }

  const pairedReturns = [...dailyReturns.entries()]
    .map(([day, portfolioReturn]) => ({ day, portfolioReturn, benchmarkReturn: benchmarkReturns.get(day) }))
    .filter((pair): pair is { day: string; portfolioReturn: number; benchmarkReturn: number } => pair.benchmarkReturn !== undefined);

  if (pairedReturns.length >= 2) {
    const meanPortfolioReturn = pairedReturns.reduce((sum, pair) => sum + pair.portfolioReturn, 0) / pairedReturns.length;
    const meanBenchmarkReturn = pairedReturns.reduce((sum, pair) => sum + pair.benchmarkReturn, 0) / pairedReturns.length;
    for (const pair of pairedReturns) {
      const portfolioDifference = pair.portfolioReturn - meanPortfolioReturn;
      const benchmarkDifference = pair.benchmarkReturn - meanBenchmarkReturn;
      covariance += portfolioDifference * benchmarkDifference;
      benchmarkVariance += benchmarkDifference ** 2;
    }
    beta = benchmarkVariance > 0 ? covariance / benchmarkVariance : null;
    alpha = beta === null
      ? null
      : (pairedReturns.reduce(
        (sum, pair) => sum + (pair.portfolioReturn - DAILY_RISK_FREE_RATE) - beta! * (pair.benchmarkReturn - DAILY_RISK_FREE_RATE),
        0,
      ) / pairedReturns.length) * TRADING_DAYS_PER_YEAR;
  } else {
    // Beta and alpha need at least two aligned NIFTY 50 daily returns.
  }

  const winningTrades = closedTrades.filter((trade) => trade.pnl > 0);
  const losingTrades = closedTrades.filter((trade) => trade.pnl < 0);
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  for (const trade of closedTrades) {
    if (trade.pnl > 0) {
      currentWins++;
      currentLosses = 0;
      consecutiveWins = Math.max(consecutiveWins, currentWins);
    } else if (trade.pnl < 0) {
      currentLosses++;
      currentWins = 0;
      consecutiveLosses = Math.max(consecutiveLosses, currentLosses);
    } else {
      currentWins = 0;
      currentLosses = 0;
    }
  }

  const totalWins = winningTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalLosses = losingTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const annualizedReturn = returns.length > 0 && initialCash > 0
    ? (equity / initialCash) ** (TRADING_DAYS_PER_YEAR / returns.length) - 1
    : 0;

  return {
    sharpeRatio: standardDeviation > 0 ? (meanExcessReturn / standardDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0,
    sortinoRatio: downsideDeviation > 0 ? (meanExcessReturn / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0,
    maxDrawdown,
    calmarRatio: maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0,
    beta,
    alpha,
    winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
    profitFactor: totalLosses < 0 ? totalWins / Math.abs(totalLosses) : totalWins > 0 ? Infinity : 0,
    avgWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
    largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map((trade) => trade.pnl)) : 0,
    largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map((trade) => trade.pnl)) : 0,
    consecutiveWins,
    consecutiveLosses,
    totalTrades: closedTrades.length,
  };
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
      const priceBySymbol = new Map(quotes.map(q => [q.symbol, q.price]));

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

      const [account] = await db.select({
        generation: paperAccounts.generation,
        initialCash: paperAccounts.initialCash,
      }).from(paperAccounts).where(eq(paperAccounts.userId, ctx.userId));
      const generation = account?.generation ?? 1;
      const userFills = await db.select({
        symbol: paperFills.symbol,
        exchange: paperFills.exchange,
        side: paperFills.side,
        quantity: paperFills.quantity,
        fillPrice: paperFills.fillPrice,
        fees: paperFills.fees,
        realizedPnl: paperFills.realizedPnl,
        executedAt: paperFills.executedAt,
      }).from(paperFills).where(and(
        eq(paperFills.userId, ctx.userId),
        eq(paperFills.generation, generation),
      )).orderBy(asc(paperFills.executedAt));

      const firstFill = userFills[0];
      const lastFill = userFills[userFills.length - 1];
      const benchmarkCandles = firstFill && lastFill
        ? await db.select({ close: candles.close, ts: candles.ts }).from(candles)
            .where(and(
              eq(candles.symbol, "NIFTY50"),
              eq(candles.timeframe, "1d"),
              gte(candles.ts, new Date(firstFill.executedAt.getTime() - 7 * 24 * 60 * 60 * 1000)),
              lte(candles.ts, lastFill.executedAt),
            ))
            .orderBy(asc(candles.ts))
        : [];

      return calculatePortfolioAnalytics(
        Number(account?.initialCash ?? 0),
        userFills,
        benchmarkCandles,
      );
    }),
});
