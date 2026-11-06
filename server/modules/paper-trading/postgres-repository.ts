import { eq, and, inArray, desc, lte, max, isNotNull, ne } from "drizzle-orm";
import { getDb } from "../../data/drizzle/client";
import {
  paperAccounts,
  paperOrders,
  paperPositions,
  paperFills,
  paperLedgerEntries,
  paperOutboxEvents,
  users,
} from "../../db/schema";
import { WORKING_ORDER_STATUSES } from "@shared/domain/paper-trading/order-status";
import { PaperPersistenceError } from "./errors";
import type {
  PaperAccountRow,
  NewPaperAccountRow,
  PaperOrderRow,
  NewPaperOrderRow,
  PaperPositionRow,
  NewPaperPositionRow,
  PaperFillRow,
  NewPaperFillRow,
  PaperLedgerEntryRow,
  NewPaperLedgerEntryRow,
  PaperOutboxEventRow,
  NewPaperOutboxEventRow,
  PaperTradingState,
} from "./contracts";
import type {
  PaperDatabase,
  PaperTransaction,
  PaperTradingRepositories,
  PaperTradingReadRepository,
  PaperTradingWriteRepository,
} from "./repository";
import {
  mapPaperAccountRow,
  mapPaperOrderRow,
  mapPaperPositionRow,
  mapPaperFillRow,
  mapPaperLedgerEntryRow,
  mapPaperOutboxEventRow,
} from "./mapper";

/**
 * Opens a generation-1 paper account funded with `initialCash` and records the matching
 * INITIAL_CASH ledger entry, so the ledger reconciles to the cash balance from day one.
 * No-op when the account already exists.
 */
async function createAccountIfMissing(tx: PaperTransaction, userId: string, initialCash: number): Promise<void> {
  const cash = initialCash.toFixed(4);
  const now = new Date();

  await tx
    .insert(users)
    .values({ id: userId, email: `${userId}@maet.internal` })
    .onConflictDoNothing();

  const created = await tx
    .insert(paperAccounts)
    .values({
      userId,
      cashBalance: cash,
      initialCash: cash,
      realisedPnl: "0.0000",
      currency: "INR",
      status: "ACTIVE",
      generation: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ userId: paperAccounts.userId });

  if (created.length === 0) return;

  await tx.insert(paperLedgerEntries).values({
    userId,
    generation: 1,
    fillId: null,
    entryType: "INITIAL_CASH",
    amount: cash,
    balanceAfter: cash,
    currency: "INR",
    sourceType: "ACCOUNT_OPEN",
    sourceId: "open:1",
    metadata: { generation: 1 },
    createdAt: now,
  });
}

export class PostgresPaperWriteRepository implements PaperTradingWriteRepository {
  constructor(readonly tx: PaperTransaction) {}

  async ensureAccountForUpdate(params: {
    userId: string;
    initialCash: number;
  }): Promise<PaperAccountRow> {
    await createAccountIfMissing(this.tx, params.userId, params.initialCash);

    const [account] = await this.tx
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, params.userId))
      .for("update");

    if (!account) {
      throw new PaperPersistenceError(`Failed to lock or create account for user ${params.userId}`);
    }

    return mapPaperAccountRow(account);
  }

  async findAccountForUpdate(params: { userId: string }): Promise<PaperAccountRow | undefined> {
    const [account] = await this.tx
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, params.userId))
      .for("update");

    return account ? mapPaperAccountRow(account) : undefined;
  }

  async findOrderByIdempotencyKeyForUpdate(params: {
    userId: string;
    generation: number;
    idempotencyKey: string;
  }): Promise<PaperOrderRow | undefined> {
    const [order] = await this.tx
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.userId, params.userId),
          eq(paperOrders.generation, params.generation),
          eq(paperOrders.idempotencyKey, params.idempotencyKey)
        )
      )
      .for("update");

    return order ? mapPaperOrderRow(order) : undefined;
  }

  async findOrderForUpdate(params: {
    userId: string;
    orderId: string;
  }): Promise<PaperOrderRow | undefined> {
    const [order] = await this.tx
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.userId, params.userId), eq(paperOrders.id, params.orderId)))
      .for("update");

    return order ? mapPaperOrderRow(order) : undefined;
  }

  async findLatestFillForOrder(orderId: string): Promise<PaperFillRow | undefined> {
    const [fill] = await this.tx
      .select()
      .from(paperFills)
      .where(eq(paperFills.orderId, orderId))
      .orderBy(desc(paperFills.executionSequence))
      .limit(1);

    return fill ? mapPaperFillRow(fill) : undefined;
  }

  async nextExecutionSequence(orderId: string): Promise<number> {
    const [row] = await this.tx
      .select({ last: max(paperFills.executionSequence) })
      .from(paperFills)
      .where(eq(paperFills.orderId, orderId));

    return (row?.last ?? 0) + 1;
  }

  async findPositionsForUpdate(params: {
    userId: string;
    generation: number;
  }): Promise<PaperPositionRow[]> {
    const rows = await this.tx
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.userId, params.userId),
          eq(paperPositions.generation, params.generation)
        )
      )
      .for("update");

    return rows.map(mapPaperPositionRow);
  }

  async findPositionForUpdate(params: {
    userId: string;
    generation: number;
    symbol: string;
    exchange: string;
  }): Promise<PaperPositionRow | undefined> {
    const [row] = await this.tx
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.userId, params.userId),
          eq(paperPositions.generation, params.generation),
          eq(paperPositions.symbol, params.symbol),
          eq(paperPositions.exchange, params.exchange)
        )
      )
      .for("update");

    return row ? mapPaperPositionRow(row) : undefined;
  }

  async insertOrder(order: NewPaperOrderRow): Promise<PaperOrderRow> {
    const [inserted] = await this.tx.insert(paperOrders).values(order).returning();
    if (!inserted) {
      throw new PaperPersistenceError("Failed to insert paper order");
    }
    return mapPaperOrderRow(inserted);
  }

  async updateOrder(orderId: string, updates: Partial<NewPaperOrderRow>): Promise<PaperOrderRow> {
    const [updated] = await this.tx
      .update(paperOrders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paperOrders.id, orderId))
      .returning();

    if (!updated) {
      throw new PaperPersistenceError(`Failed to update order ${orderId}`);
    }
    return mapPaperOrderRow(updated);
  }

  async cancelOpenOrders(params: {
    userId: string;
    generation: number;
    reason: string;
  }): Promise<PaperOrderRow[]> {
    const rows = await this.tx
      .update(paperOrders)
      .set({
        status: "CANCELLED",
        rejectReason: params.reason,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paperOrders.userId, params.userId),
          eq(paperOrders.generation, params.generation),
          inArray(paperOrders.status, [...WORKING_ORDER_STATUSES])
        )
      )
      .returning();

    return rows.map(mapPaperOrderRow);
  }

  async findWorkingChildOrdersForUpdate(params: {
    userId: string;
    parentOrderId: string;
  }): Promise<PaperOrderRow[]> {
    const rows = await this.tx
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.userId, params.userId),
          eq(paperOrders.parentOrderId, params.parentOrderId),
          inArray(paperOrders.status, [...WORKING_ORDER_STATUSES])
        )
      )
      .orderBy(paperOrders.placedAt)
      .for("update");

    return rows.map(mapPaperOrderRow);
  }

  async cancelWorkingExits(params: {
    userId: string;
    generation: number;
    symbol: string;
    exchange: string;
    keepParentOrderId: string;
    reason: string;
  }): Promise<PaperOrderRow[]> {
    const now = new Date();
    const rows = await this.tx
      .update(paperOrders)
      .set({ status: "CANCELLED", rejectReason: params.reason, cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(paperOrders.userId, params.userId),
          eq(paperOrders.generation, params.generation),
          eq(paperOrders.symbol, params.symbol),
          eq(paperOrders.exchange, params.exchange),
          isNotNull(paperOrders.parentOrderId),
          ne(paperOrders.parentOrderId, params.keepParentOrderId),
          inArray(paperOrders.status, [...WORKING_ORDER_STATUSES])
        )
      )
      .returning();

    return rows.map(mapPaperOrderRow);
  }

  async upsertPosition(position: NewPaperPositionRow): Promise<PaperPositionRow> {
    const [upserted] = await this.tx
      .insert(paperPositions)
      .values(position)
      .onConflictDoUpdate({
        target: [
          paperPositions.userId,
          paperPositions.generation,
          paperPositions.symbol,
          paperPositions.exchange,
        ],
        set: {
          averageEntryPrice: position.averageEntryPrice,
          totalShares: position.totalShares,
          side: position.side,
          realizedPnl: position.realizedPnl,
          unrealizedPnl: position.unrealizedPnl,
          marginLocked: position.marginLocked,
          lastQuotePrice: position.lastQuotePrice,
          lastQuoteSource: position.lastQuoteSource,
          lastQuoteQuality: position.lastQuoteQuality,
          lastQuoteTimestamp: position.lastQuoteTimestamp,
          version: position.version,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!upserted) {
      throw new PaperPersistenceError("Failed to upsert paper position");
    }
    return mapPaperPositionRow(upserted);
  }

  async deletePosition(params: {
    userId: string;
    generation: number;
    symbol: string;
    exchange: string;
  }): Promise<void> {
    await this.tx
      .delete(paperPositions)
      .where(
        and(
          eq(paperPositions.userId, params.userId),
          eq(paperPositions.generation, params.generation),
          eq(paperPositions.symbol, params.symbol),
          eq(paperPositions.exchange, params.exchange)
        )
      );
  }

  async insertFill(fill: NewPaperFillRow): Promise<PaperFillRow> {
    const [inserted] = await this.tx.insert(paperFills).values(fill).returning();
    if (!inserted) {
      throw new PaperPersistenceError("Failed to insert paper fill");
    }
    return mapPaperFillRow(inserted);
  }

  async insertLedgerEntries(entries: NewPaperLedgerEntryRow[]): Promise<PaperLedgerEntryRow[]> {
    if (entries.length === 0) return [];
    const inserted = await this.tx.insert(paperLedgerEntries).values(entries).returning();
    return inserted.map(mapPaperLedgerEntryRow);
  }

  async insertOutboxEvents(events: NewPaperOutboxEventRow[]): Promise<PaperOutboxEventRow[]> {
    if (events.length === 0) return [];
    const inserted = await this.tx.insert(paperOutboxEvents).values(events).returning();
    return inserted.map(mapPaperOutboxEventRow);
  }

  async updateAccount(
    userId: string,
    updates: Partial<NewPaperAccountRow>
  ): Promise<PaperAccountRow> {
    const [updated] = await this.tx
      .update(paperAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paperAccounts.userId, userId))
      .returning();

    if (!updated) {
      throw new PaperPersistenceError(`Failed to update account for user ${userId}`);
    }
    return mapPaperAccountRow(updated);
  }
}

export class PostgresPaperReadRepository implements PaperTradingReadRepository {
  constructor(readonly db: PaperDatabase) {}

  async getState(params: { userId: string; initialCash: number }): Promise<PaperTradingState> {
    let [account] = await this.db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, params.userId));

    if (!account) {
      await this.db.transaction((tx) => createAccountIfMissing(tx, params.userId, params.initialCash));
      [account] = await this.db
        .select()
        .from(paperAccounts)
        .where(eq(paperAccounts.userId, params.userId));
    }

    if (!account) {
      throw new PaperPersistenceError(`Could not find or initialize account for user ${params.userId}`);
    }

    const gen = account.generation;

    const positions = await this.db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.userId, params.userId),
          eq(paperPositions.generation, gen)
        )
      );

    const orders = await this.db
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.userId, params.userId),
          eq(paperOrders.generation, gen)
        )
      )
      .orderBy(desc(paperOrders.placedAt));

    const fills = await this.db
      .select()
      .from(paperFills)
      .where(
        and(
          eq(paperFills.userId, params.userId),
          eq(paperFills.generation, gen)
        )
      )
      .orderBy(desc(paperFills.executedAt));

    return {
      account: mapPaperAccountRow(account),
      positions: positions.map(mapPaperPositionRow),
      orders: orders.map(mapPaperOrderRow),
      fills: fills.map(mapPaperFillRow),
      asOf: new Date(),
    };
  }

  /** Explicit generation, else the account's current one (history from before a reset stays opt-in). */
  private async resolveGeneration(userId: string, generation: number | undefined): Promise<number> {
    if (generation !== undefined) return generation;
    const [account] = await this.db
      .select({ generation: paperAccounts.generation })
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, userId));
    return account?.generation ?? 1;
  }

  async listOrders(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: PaperOrderRow[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit || 50, 100);
    const gen = await this.resolveGeneration(params.userId, params.generation);

    const conditions = [
      eq(paperOrders.userId, params.userId),
      eq(paperOrders.generation, gen),
    ];

    if (params.cursor) {
      conditions.push(lte(paperOrders.placedAt, new Date(params.cursor)));
    }

    const rows = await this.db
      .select()
      .from(paperOrders)
      .where(and(...conditions))
      .orderBy(desc(paperOrders.placedAt))
      .limit(limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows.pop()!;
      nextCursor = nextItem.placedAt.toISOString();
    }

    return {
      orders: rows.map(mapPaperOrderRow),
      nextCursor,
    };
  }

  async listFills(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ fills: PaperFillRow[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit || 50, 100);
    const gen = await this.resolveGeneration(params.userId, params.generation);

    const conditions = [
      eq(paperFills.userId, params.userId),
      eq(paperFills.generation, gen),
    ];

    if (params.cursor) {
      conditions.push(lte(paperFills.executedAt, new Date(params.cursor)));
    }

    const rows = await this.db
      .select()
      .from(paperFills)
      .where(and(...conditions))
      .orderBy(desc(paperFills.executedAt))
      .limit(limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows.pop()!;
      nextCursor = nextItem.executedAt.toISOString();
    }

    return {
      fills: rows.map(mapPaperFillRow),
      nextCursor,
    };
  }

  async listLedger(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ entries: PaperLedgerEntryRow[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit || 50, 100);
    const gen = await this.resolveGeneration(params.userId, params.generation);

    const conditions = [
      eq(paperLedgerEntries.userId, params.userId),
      eq(paperLedgerEntries.generation, gen),
    ];

    if (params.cursor) {
      conditions.push(lte(paperLedgerEntries.createdAt, new Date(params.cursor)));
    }

    const rows = await this.db
      .select()
      .from(paperLedgerEntries)
      .where(and(...conditions))
      .orderBy(desc(paperLedgerEntries.createdAt))
      .limit(limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows.pop()!;
      nextCursor = nextItem.createdAt.toISOString();
    }

    return {
      entries: rows.map(mapPaperLedgerEntryRow),
      nextCursor,
    };
  }
}

export function createPostgresPaperRepositories(
  tx: PaperTransaction
): PaperTradingRepositories {
  return {
    write: new PostgresPaperWriteRepository(tx),
    read: undefined as unknown as PaperTradingReadRepository,
  };
}

export function createPostgresPaperReadRepository(
  db?: PaperDatabase
): PaperTradingReadRepository {
  return new PostgresPaperReadRepository(db ?? (getDb() as any));
}
