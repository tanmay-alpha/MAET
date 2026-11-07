import { eq, and, inArray, desc, lte, max, isNotNull, ne, sql, getTableColumns, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
import { PaperPersistenceError, PaperValidationError } from "./errors";
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

/** Orders that can still fill; everything else is terminal. */
const WORKING_ORDER_STATUSES = ["PENDING", "TRIGGER_PENDING", "TRIGGERED", "PARTIALLY_FILLED"] as const;

const PAGE_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const PAGE_CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exact UTC text of a timestamptz column for page cursors. Postgres stores microseconds;
 * a JS Date would truncate to milliseconds and make the keyset skip rows.
 */
function cursorTimestamp(column: AnyPgColumn): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Keyset predicate for newest-first lists ordered by (timestamp DESC, id DESC). The id
 * tie-breaks rows written in one transaction, which share a timestamp. Legacy
 * timestamp-only cursors (ISO strings) still resolve with the old inclusive bound.
 */
function pageCursorCondition(cursor: string, timestampColumn: AnyPgColumn, idColumn: AnyPgColumn): SQL {
  if (/^[A-Za-z0-9_-]+$/.test(cursor)) {
    const [timestamp = "", id = "", ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (rest.length === 0 && PAGE_CURSOR_TIMESTAMP.test(timestamp) && PAGE_CURSOR_ID.test(id)) {
      return sql`(${timestampColumn}, ${idColumn}) < (${timestamp}::timestamptz, ${id}::uuid)`;
    }
  }
  const legacy = new Date(cursor);
  if (cursor.includes("T") && !Number.isNaN(legacy.getTime())) {
    return lte(timestampColumn, legacy);
  }
  throw new PaperValidationError("Invalid pagination cursor");
}

/** Trims the probe row and derives the opaque cursor from the last row returned. */
function toPage<T extends { id: string; cursorTs: string }>(
  rows: T[],
  limit: number
): { rows: Omit<T, "cursorTs">[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last
    ? Buffer.from(`${last.cursorTs}|${last.id}`, "utf8").toString("base64url")
    : null;
  return { rows: page.map(({ cursorTs: _cursorTs, ...row }) => row), nextCursor };
}

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
      conditions.push(pageCursorCondition(params.cursor, paperOrders.placedAt, paperOrders.id));
    }

    const rows = await this.db
      .select({ ...getTableColumns(paperOrders), cursorTs: cursorTimestamp(paperOrders.placedAt) })
      .from(paperOrders)
      .where(and(...conditions))
      .orderBy(desc(paperOrders.placedAt), desc(paperOrders.id))
      .limit(limit + 1);

    const page = toPage(rows, limit);
    return {
      orders: page.rows.map(mapPaperOrderRow),
      nextCursor: page.nextCursor,
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
      conditions.push(pageCursorCondition(params.cursor, paperFills.executedAt, paperFills.id));
    }

    const rows = await this.db
      .select({ ...getTableColumns(paperFills), cursorTs: cursorTimestamp(paperFills.executedAt) })
      .from(paperFills)
      .where(and(...conditions))
      .orderBy(desc(paperFills.executedAt), desc(paperFills.id))
      .limit(limit + 1);

    const page = toPage(rows, limit);
    return {
      fills: page.rows.map(mapPaperFillRow),
      nextCursor: page.nextCursor,
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
      conditions.push(pageCursorCondition(params.cursor, paperLedgerEntries.createdAt, paperLedgerEntries.id));
    }

    const rows = await this.db
      .select({ ...getTableColumns(paperLedgerEntries), cursorTs: cursorTimestamp(paperLedgerEntries.createdAt) })
      .from(paperLedgerEntries)
      .where(and(...conditions))
      .orderBy(desc(paperLedgerEntries.createdAt), desc(paperLedgerEntries.id))
      .limit(limit + 1);

    const page = toPage(rows, limit);
    return {
      entries: page.rows.map(mapPaperLedgerEntryRow),
      nextCursor: page.nextCursor,
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
