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

  /** Locks the user's account row, creating it (with its INITIAL_CASH ledger entry) on first use. */
  ensureAccountForUpdate(params: {
    userId: string;
    initialCash: number;
  }): Promise<PaperAccountRow>;

  findAccountForUpdate(params: {
    userId: string;
  }): Promise<PaperAccountRow | undefined>;

  /** Idempotency keys are scoped to one account generation. */
  findOrderByIdempotencyKeyForUpdate(params: {
    userId: string;
    generation: number;
    idempotencyKey: string;
  }): Promise<PaperOrderRow | undefined>;

  findOrderForUpdate(params: {
    userId: string;
    orderId: string;
  }): Promise<PaperOrderRow | undefined>;

  /** Latest fill of an order (highest execution sequence), if any. */
  findLatestFillForOrder(orderId: string): Promise<PaperFillRow | undefined>;

  /** Next execution_sequence for an order. Callers MUST hold the order row lock. */
  nextExecutionSequence(orderId: string): Promise<number>;

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

  /** Cancels every working order (PENDING, TRIGGER_PENDING, TRIGGERED, PARTIALLY_FILLED) of a generation. */
  cancelOpenOrders(params: {
    userId: string;
    generation: number;
    reason: string;
  }): Promise<PaperOrderRow[]>;

  /** Locks the working bracket exits (children) of a parent order. */
  findWorkingChildOrdersForUpdate(params: {
    userId: string;
    parentOrderId: string;
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
  getState(params: { userId: string; initialCash: number }): Promise<PaperTradingState>;

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
