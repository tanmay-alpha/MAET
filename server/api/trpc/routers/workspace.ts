import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../data/drizzle/client";
import {
  savedScreenerDefinitions,
  savedScreenerRuns,
  userNotifications,
  userWatchlists,
  watchlistItems,
} from "../../../db/schema";
import { createRouter, protectedProcedure } from "../core";

const watchlistNameSchema = z.string().trim().min(1).max(80);
const watchlistSymbolSchema = z.string().trim().min(1).max(20).transform((symbol) => symbol.toUpperCase());
const watchlistNoteSchema = z.string().transform((note) => note.trim()).pipe(z.string().max(512)).nullable()
  .transform((note) => note || null);
const savedScreenerNameSchema = z.string().trim().min(1).max(80);

function inaccessible(resource: "Watchlist" | "Watchlist item" | "Saved screener"): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${resource} not found or access denied` });
}

const watchlistItemSelection = {
  id: watchlistItems.id,
  watchlistId: watchlistItems.watchlistId,
  symbol: watchlistItems.symbol,
  exchange: watchlistItems.exchange,
  note: watchlistItems.note,
  position: watchlistItems.position,
  createdAt: watchlistItems.createdAt,
};

export const workspaceRouter = createRouter({
  getOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.userId;
    const [watchlistCount] = await db.select({ count: sql`count(*)` }).from(userWatchlists)
      .where(eq(userWatchlists.userId, userId));
    const [screenerCount] = await db.select({ count: sql`count(*)` }).from(savedScreenerDefinitions)
      .where(eq(savedScreenerDefinitions.userId, userId));
    const [notificationCount] = await db.select({ count: sql`count(*)` }).from(userNotifications)
      .where(and(eq(userNotifications.userId, userId), sql`${userNotifications.readAt} IS NULL`));

    return {
      watchlistCount: Number(watchlistCount?.count ?? 0),
      screenerCount: Number(screenerCount?.count ?? 0),
      unreadNotifications: Number(notificationCount?.count ?? 0),
    };
  }),

  listWatchlists: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await db.select({
        id: userWatchlists.id,
        name: userWatchlists.name,
        description: userWatchlists.description,
        isPinned: userWatchlists.isPinned,
        position: userWatchlists.position,
        createdAt: userWatchlists.createdAt,
        updatedAt: userWatchlists.updatedAt,
      }).from(userWatchlists)
        .where(eq(userWatchlists.userId, ctx.userId))
        .orderBy(asc(userWatchlists.position), asc(userWatchlists.createdAt), asc(userWatchlists.id))
        .limit(input?.limit ?? 20);

      if (rows.length === 0) return { items: [] };

      const itemRows = await db.select(watchlistItemSelection).from(watchlistItems)
        .where(and(
          eq(watchlistItems.userId, ctx.userId),
          inArray(watchlistItems.watchlistId, rows.map((watchlist) => watchlist.id)),
        ))
        .orderBy(asc(watchlistItems.position), asc(watchlistItems.createdAt), asc(watchlistItems.id));
      const itemsByWatchlist = new Map<string, Omit<(typeof itemRows)[number], "watchlistId">[]>();

      for (const { watchlistId, ...item } of itemRows) {
        const items = itemsByWatchlist.get(watchlistId) ?? [];
        items.push(item);
        itemsByWatchlist.set(watchlistId, items);
      }

      return {
        items: rows.map((watchlist) => ({
          ...watchlist,
          items: itemsByWatchlist.get(watchlist.id) ?? [],
        })),
      };
    }),

  createWatchlist: protectedProcedure
    .input(z.object({ name: watchlistNameSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const [watchlist] = await db.insert(userWatchlists)
        .values({ userId: ctx.userId, name: input.name })
        .returning();
      return watchlist;
    }),

  renameWatchlist: protectedProcedure
    .input(z.object({ watchlistId: z.string().uuid(), name: watchlistNameSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const [watchlist] = await db.update(userWatchlists)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(userWatchlists.id, input.watchlistId), eq(userWatchlists.userId, ctx.userId)))
        .returning();
      return watchlist ?? inaccessible("Watchlist");
    }),

  deleteWatchlist: protectedProcedure
    .input(z.object({ watchlistId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db.delete(userWatchlists)
        .where(and(eq(userWatchlists.id, input.watchlistId), eq(userWatchlists.userId, ctx.userId)))
        .returning({ id: userWatchlists.id });
      if (!deleted) inaccessible("Watchlist");
      return { success: true };
    }),

  addWatchlistItem: protectedProcedure
    .input(z.object({
      watchlistId: z.string().uuid(),
      symbol: watchlistSymbolSchema,
      exchange: z.enum(["NSE", "BSE"]).default("NSE"),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const [watchlist] = await db.select({ id: userWatchlists.id }).from(userWatchlists)
        .where(and(eq(userWatchlists.id, input.watchlistId), eq(userWatchlists.userId, ctx.userId)))
        .limit(1);
      if (!watchlist) inaccessible("Watchlist");

      const [inserted] = await db.insert(watchlistItems).values({
        userId: ctx.userId,
        watchlistId: input.watchlistId,
        symbol: input.symbol,
        exchange: input.exchange,
      }).onConflictDoNothing().returning(watchlistItemSelection);
      if (inserted) {
        const { watchlistId: _watchlistId, ...item } = inserted;
        return item;
      }

      const [existing] = await db.select(watchlistItemSelection).from(watchlistItems)
        .where(and(
          eq(watchlistItems.watchlistId, input.watchlistId),
          eq(watchlistItems.userId, ctx.userId),
          eq(watchlistItems.symbol, input.symbol),
          eq(watchlistItems.exchange, input.exchange),
        ))
        .limit(1);
      if (!existing) inaccessible("Watchlist item");
      const { watchlistId: _watchlistId, ...item } = existing;
      return item;
    }),

  removeWatchlistItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db.delete(watchlistItems)
        .where(and(eq(watchlistItems.id, input.itemId), eq(watchlistItems.userId, ctx.userId)))
        .returning({ id: watchlistItems.id });
      if (!deleted) inaccessible("Watchlist item");
      return { success: true };
    }),

  updateWatchlistItemNote: protectedProcedure
    .input(z.object({ itemId: z.string().uuid(), note: watchlistNoteSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const [item] = await db.update(watchlistItems)
        .set({ note: input.note })
        .where(and(eq(watchlistItems.id, input.itemId), eq(watchlistItems.userId, ctx.userId)))
        .returning(watchlistItemSelection);
      if (!item) inaccessible("Watchlist item");
      const { watchlistId: _watchlistId, ...result } = item;
      return result;
    }),

  reorderWatchlistItems: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        itemId: z.string().uuid(),
        position: z.number().int().min(0),
      })).min(1),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const itemIds = input.items.map((item) => item.itemId);
      if (new Set(itemIds).size !== itemIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate item IDs in reorder request" });
      }

      return db.transaction(async (tx) => {
        const rows = await tx.select({ id: watchlistItems.id }).from(watchlistItems)
          .where(and(eq(watchlistItems.userId, ctx.userId), inArray(watchlistItems.id, itemIds)));
        if (rows.length !== itemIds.length) inaccessible("Watchlist item");

        for (const item of input.items) {
          await tx.update(watchlistItems).set({ position: item.position })
            .where(and(eq(watchlistItems.id, item.itemId), eq(watchlistItems.userId, ctx.userId)));
        }
        return { success: true };
      });
    }),

  listSavedScreeners: protectedProcedure.query(async ({ ctx }) => {
    return db.select().from(savedScreenerDefinitions)
      .where(and(
        eq(savedScreenerDefinitions.userId, ctx.userId),
        eq(savedScreenerDefinitions.isArchived, false),
      ))
      .orderBy(desc(savedScreenerDefinitions.isPinned), desc(savedScreenerDefinitions.updatedAt), asc(savedScreenerDefinitions.id));
  }),

  saveScreener: protectedProcedure
    .input(z.object({
      name: savedScreenerNameSchema,
      criteria: z.record(z.unknown()),
      description: z.string().optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const [savedScreener] = await db.insert(savedScreenerDefinitions)
        .values({ userId: ctx.userId, ...input })
        .returning();
      return savedScreener;
    }),

  updateScreener: protectedProcedure
    .input(z.object({
      screenerId: z.string().uuid(),
      name: savedScreenerNameSchema.optional(),
      criteria: z.record(z.unknown()).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const { screenerId, ...updates } = input;
      const [savedScreener] = await db.update(savedScreenerDefinitions)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(
          eq(savedScreenerDefinitions.id, screenerId),
          eq(savedScreenerDefinitions.userId, ctx.userId),
        ))
        .returning();
      return savedScreener ?? inaccessible("Saved screener");
    }),

  deleteScreener: protectedProcedure
    .input(z.object({ screenerId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [savedScreener] = await db.update(savedScreenerDefinitions)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(and(
          eq(savedScreenerDefinitions.id, input.screenerId),
          eq(savedScreenerDefinitions.userId, ctx.userId),
        ))
        .returning({ id: savedScreenerDefinitions.id });
      if (!savedScreener) inaccessible("Saved screener");
      return { success: true };
    }),

  runSavedScreener: protectedProcedure
    .input(z.object({ screenerId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [savedScreener] = await db.select({ id: savedScreenerDefinitions.id })
        .from(savedScreenerDefinitions)
        .where(and(
          eq(savedScreenerDefinitions.id, input.screenerId),
          eq(savedScreenerDefinitions.userId, ctx.userId),
          eq(savedScreenerDefinitions.isArchived, false),
        ))
        .limit(1);
      if (!savedScreener) inaccessible("Saved screener");

      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Saved views can be loaded, but server-side saved-run execution is not connected",
      });
    }),

  listRecentRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(20).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      return db.select().from(savedScreenerRuns)
        .where(eq(savedScreenerRuns.userId, ctx.userId))
        .orderBy(desc(savedScreenerRuns.runStartedAt), desc(savedScreenerRuns.id))
        .limit(input?.limit ?? 10);
    }),

  pinComparison: protectedProcedure
    .input(z.object({ symbols: z.array(watchlistSymbolSchema).min(2).max(10) }).strict())
    .mutation(async ({ ctx, input }) => {
      const existing = await db.select().from(userWatchlists)
        .where(eq(userWatchlists.userId, ctx.userId))
        .orderBy(asc(userWatchlists.position), asc(userWatchlists.createdAt), asc(userWatchlists.id))
        .limit(1);
      let watchlist = existing[0];
      if (!watchlist) {
        [watchlist] = await db.insert(userWatchlists)
          .values({ userId: ctx.userId, name: "Pinned Comparison" })
          .returning();
      }

      await db.insert(watchlistItems).values(input.symbols.map((symbol) => ({
        userId: ctx.userId,
        watchlistId: watchlist.id,
        symbol,
        exchange: "NSE",
        position: 0,
      }))).onConflictDoNothing();
      return { watchlistId: watchlist.id, symbols: input.symbols };
    }),
});
