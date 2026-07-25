import type { getDb } from "../../data/drizzle/client";
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

export type PaperDatabase = ReturnType<typeof getDb>;
export type PaperTransaction = Parameters<Parameters<PaperDatabase["transaction"]>[0]>[0];

export interface PaperTransactionContext {
  tx: PaperTransaction;
}

export interface PaperTradingWriteRepository {
  readonly tx: PaperTransaction;

  ensureAccountForUpdate(params: {
    userId: string;
    initialCash?: number | string;
  }): Promise<PaperAccountRow>;

  findAccountForUpdate(params: {
    userId: string;
  }): Promise<PaperAccountRow | undefined>;

  findOrderByIdempotencyKeyForUpdate(params: {
    userId: string;
    idempotencyKey: string;
  }): Promise<PaperOrderRow | undefined>;

  findOrderForUpdate(params: {
    userId: string;
    orderId: string;
  }): Promise<PaperOrderRow | undefined>;

  findPositionsForUpdate(params: {
    userId: string;
    generation: number;
  }): Promise<PaperPositionRow[]>;

  findPositionForUpdate(params: {
    userId: string;
    generation: number;
    symbol: string;
    exchange: string;
  }): Promise<PaperPositionRow | undefined>;

  insertOrder(order: NewPaperOrderRow): Promise<PaperOrderRow>;

  updateOrder(orderId: string, updates: Partial<NewPaperOrderRow>): Promise<PaperOrderRow>;

  cancelOpenOrders(params: {
    userId: string;
    generation: number;
    reason: string;
  }): Promise<PaperOrderRow[]>;

  upsertPosition(position: NewPaperPositionRow): Promise<PaperPositionRow>;

  deletePosition(params: {
    userId: string;
    generation: number;
    symbol: string;
    exchange: string;
  }): Promise<void>;

  insertFill(fill: NewPaperFillRow): Promise<PaperFillRow>;

  insertLedgerEntries(entries: NewPaperLedgerEntryRow[]): Promise<PaperLedgerEntryRow[]>;

  insertOutboxEvents(events: NewPaperOutboxEventRow[]): Promise<PaperOutboxEventRow[]>;

  updateAccount(userId: string, updates: Partial<NewPaperAccountRow>): Promise<PaperAccountRow>;
}

export interface PaperTradingReadRepository {
  getState(params: { userId: string }): Promise<PaperTradingState>;

  listOrders(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: PaperOrderRow[]; nextCursor: string | null }>;

  listFills(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ fills: PaperFillRow[]; nextCursor: string | null }>;

  listLedger(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ entries: PaperLedgerEntryRow[]; nextCursor: string | null }>;
}

export interface PaperTradingRepositories {
  write: PaperTradingWriteRepository;
  read: PaperTradingReadRepository;
}
