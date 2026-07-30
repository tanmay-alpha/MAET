import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { userWatchlists, watchlistItems, savedScreenerDefinitions, savedScreenerRuns, userNotifications } from "../../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const workspaceRouter = createRouter({

  // Get overview of workspace
  getOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.userId!;
    const [watchlistCount] = await db.select({ count: sql`count(*)` }).from(userWatchlists).where(eq(userWatchlists.userId, userId));
    const [screenerCount] = await db.select({ count: sql`count(*)` }).from(savedScreenerDefinitions).where(eq(savedScreenerDefinitions.userId, userId));
    const [notificationCount] = await db.select({ count: sql`count(*)` }).from(userNotifications).where(and(eq(userNotifications.userId, userId), sql`${userNotifications.readAt} IS NULL`));

    return {
      watchlistCount: Number(watchlistCount?.count ?? 0),
      screenerCount: Number(screenerCount?.count ?? 0),
      unreadNotifications: Number(notificationCount?.count ?? 0),
    };
  }),

  // List user watchlists
  listWatchlists: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx }) => {
      const userId = ctx.userId!;
      const rows = await db.select().from(userWatchlists).where(eq(userWatchlists.userId, userId)).orderBy(userWatchlists.position, userWatchlists.createdAt).limit(20);
      return { items: rows };
    }),

  createWatchlist: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      const result = await db.insert(userWatchlists).values({ userId, name: input.name }).returning();
      return result[0];
    }),

  renameWatchlist: protectedProcedure
    .input(z.object({ watchlistId: z.string().uuid(), name: z.string().min(1).max(80) }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      const result = await db.update(userWatchlists).set({ name: input.name }).where(and(eq(userWatchlists.id, input.watchlistId), eq(userWatchlists.userId, userId))).returning();
      return result[0] ?? null;
    }),

  deleteWatchlist: protectedProcedure
    .input(z.object({ watchlistId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      await db.delete(userWatchlists).where(and(eq(userWatchlists.id, input.watchlistId), eq(userWatchlists.userId, userId)));
      return { success: true };
    }),

  addWatchlistItem: protectedProcedure
    .input(z.object({ watchlistId: z.string().uuid(), symbol: z.string().min(1).max(20), exchange: z.enum(["NSE", "BSE"]).default("NSE") }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      const result = await db.insert(watchlistItems).values({ userId, watchlistId: input.watchlistId, symbol: input.symbol.toUpperCase(), exchange: input.exchange }).returning();
      return result[0];
    }),

  removeWatchlistItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      await db.delete(watchlistItems).where(and(eq(watchlistItems.id, input.itemId), eq(watchlistItems.userId, userId)));
      return { success: true };
    }),

  reorderWatchlistItems: protectedProcedure
    .input(z.object({ items: z.array(z.object({ itemId: z.string().uuid(), position: z.number().int() })).min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      // Validate ownership then batch update
      const itemIds = input.items.map(i => i.itemId);
      const rows = await db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, userId), sql`${watchlistItems.id} = ANY(${itemIds}::uuid[])`));
      if (rows.length !== itemIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid item IDs" });

      for (const item of input.items) {
        await db.update(watchlistItems).set({ position: item.position }).where(eq(watchlistItems.id, item.itemId));
      }
      return { success: true };
    }),

  // Saved screener CRUD
  listSavedScreeners: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.userId!;
    return await db.select().from(savedScreenerDefinitions).where(and(eq(savedScreenerDefinitions.userId, userId), eq(savedScreenerDefinitions.isArchived, false))).orderBy(savedScreenerDefinitions.isPinned, savedScreenerDefinitions.updatedAt);
  }),

  saveScreener: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80), criteria: z.record(z.any()), description: z.string().optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      const result = await db.insert(savedScreenerDefinitions).values({ userId, name: input.name, criteria: input.criteria, description: input.description }).returning();
      return result[0];
    }),

  updateScreener: protectedProcedure
    .input(z.object({ screenerId: z.string().uuid(), name: z.string().min(1).max(80).optional(), criteria: z.record(z.any()).optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      const { screenerId, ...updates } = input;
      const result = await db.update(savedScreenerDefinitions).set(updates).where(and(eq(savedScreenerDefinitions.id, screenerId), eq(savedScreenerDefinitions.userId, userId))).returning();
      return result[0] ?? null;
    }),

  deleteScreener: protectedProcedure
    .input(z.object({ screenerId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      await db.update(savedScreenerDefinitions).set({ isArchived: true }).where(and(eq(savedScreenerDefinitions.id, input.screenerId), eq(savedScreenerDefinitions.userId, userId)));
      return { success: true };
    }),

  runSavedScreener: protectedProcedure
    .input(z.object({ screenerId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      const run = await db.insert(savedScreenerRuns).values({ userId, screenerId: input.screenerId, symbols: [], matchCount: 0 }).returning();
      return { runId: run[0].id };
    }),

  listRecentRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(20).default(10) }).optional())
    .query(async ({ ctx }) => {
      const userId = ctx.userId!;
      return await db.select().from(savedScreenerRuns).where(eq(savedScreenerRuns.userId, userId)).orderBy(desc(savedScreenerRuns.runStartedAt)).limit(10);
    }),

  pinComparison: protectedProcedure
    .input(z.object({ symbols: z.array(z.string().min(1)).min(2).max(10) }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId!;
      // Store as a watchlist for now (backed by existing infrastructure)
      const existing = await db.select().from(userWatchlists).where(eq(userWatchlists.userId, userId)).limit(1);
      let wl;
      if (existing.length > 0) {
        wl = existing[0];
      } else {
        const result = await db.insert(userWatchlists).values({ userId, name: "Pinned Comparison" }).returning();
        wl = result[0];
      }
      // Add each symbol
      const items = input.symbols.map(s => ({ userId: ctx.userId!, watchlistId: wl.id, symbol: s.toUpperCase(), exchange: "NSE" as const, position: 0 }));
      await db.insert(watchlistItems).values(items).onConflictDoNothing();
      return { watchlistId: wl.id, symbols: input.symbols };
    }),
});