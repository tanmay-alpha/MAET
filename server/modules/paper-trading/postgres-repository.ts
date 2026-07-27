import { eq, and, inArray, desc, lte } from "drizzle-orm";
import {
  paperAccounts,
  paperOrders,
  paperPositions,
  paperFills,
  paperLedgerEntries,
  paperOutboxEvents,
  users,
} from "../../db/schema";
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

export class PostgresPaperWriteRepository implements PaperTradingWriteRepository {
  constructor(readonly tx: PaperTransaction) {}

  async ensureAccountForUpdate(params: {
    userId: string;
    initialCash?: number | string;
  }): Promise<PaperAccountRow> {
    const cashStr = params.initialCash ? String(params.initialCash) : "1000000.0000";

    await this.tx
      .insert(users)
      .values({
        id: params.userId,
        email: `${params.userId}@maet.internal`,
      })
      .onConflictDoNothing();

    await this.tx
      .insert(paperAccounts)
      .values({
        userId: params.userId,
        cashBalance: cashStr,
        initialCash: cashStr,
        realisedPnl: "0.0000",
        currency: "INR",
        status: "ACTIVE",
        generation: 1,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

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
    idempotencyKey: string;
  }): Promise<PaperOrderRow | undefined> {
    const [order] = await this.tx
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.userId, params.userId),
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
          inArray(paperOrders.status, ["PENDING", "TRIGGER_PENDING"])
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
          realizedPnl: position.realizedPnl,
          unrealizedPnl: position.unrealizedPnl,
          marginLocked: position.marginLocked,
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

  async getState(params: { userId: string }): Promise<PaperTradingState> {
    let [account] = await this.db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, params.userId));

    if (!account) {
      const [newAccount] = await this.db
        .insert(paperAccounts)
        .values({
          userId: params.userId,
          cashBalance: "1000000.0000",
          initialCash: "1000000.0000",
          realisedPnl: "0.0000",
          currency: "INR",
          status: "ACTIVE",
          generation: 1,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      account = newAccount;
      if (!account) {
        const [reFetched] = await this.db
          .select()
          .from(paperAccounts)
          .where(eq(paperAccounts.userId, params.userId));
        account = reFetched;
      }
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

  async listOrders(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: PaperOrderRow[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit || 50, 100);
    const gen = params.generation || 1;

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
    const gen = params.generation || 1;

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
    const gen = params.generation || 1;

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
  db: PaperDatabase
): PaperTradingReadRepository {
  return new PostgresPaperReadRepository(db);
}
