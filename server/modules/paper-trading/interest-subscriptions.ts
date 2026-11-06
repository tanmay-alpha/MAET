/**
 * "Paper interest" source for the live market feed.
 *
 * The Angel One feed only streams symbols somebody subscribed. Without this
 * source a resting LIMIT/stop order on a symbol nobody is watching never got a
 * tick, so it never filled, and open positions were not marked for margin
 * monitoring. This keeps the symbols of every working order and open position
 * (current account generations, all users) subscribed through the
 * orchestrator's ref-counted registry, holding one reference per symbol.
 */
import { sql } from "drizzle-orm";
import { MAX_STREAM_SYMBOLS } from "@shared/types";
import { WORKING_ORDER_STATUSES } from "@shared/domain/paper-trading/order-status";
import { getDb } from "../../data/drizzle/client";
import { DatabaseUnavailableError, withOptionalDatabase } from "../../data/drizzle/availability";

export type PaperInterestKind = "ORDER" | "POSITION";

export interface PaperInterestRow {
  exchange: string;
  symbol: string;
  kind: PaperInterestKind;
}

/** Exchanges the live feed streams (the socket subscribes NSE cash, exchangeType 1). */
const STREAMED_EXCHANGES: Record<string, true> = { NSE: true };

export const PAPER_INTEREST_REFRESH_MS = 60_000;

/** `'PENDING', 'TRIGGER_PENDING', …` inlined from the shared constant (fixed enum labels, no user input). */
const WORKING_STATUS_LIST = sql.raw(WORKING_ORDER_STATUSES.map((status) => `'${status}'`).join(", "));

/**
 * Distinct EXCHANGE:SYMBOL pairs with a working order or an open position in
 * the owning account's current generation. Working orders come first (oldest
 * first), then positions, so a capped subscription keeps fills flowing first.
 */
export async function listPaperInterest(): Promise<PaperInterestRow[]> {
  const rows = await getDb().execute<{ exchange: string; symbol: string; kind: PaperInterestKind }>(sql`
    SELECT exchange, symbol, kind FROM (
      SELECT o.exchange, o.symbol, 'ORDER' AS kind, 0 AS rank, MIN(o.placed_at) AS since
      FROM public.paper_orders o
      JOIN public.paper_accounts a ON a.user_id = o.user_id AND a.generation = o.generation
      WHERE o.status IN (${WORKING_STATUS_LIST})
      GROUP BY o.exchange, o.symbol
      UNION ALL
      SELECT p.exchange, p.symbol, 'POSITION' AS kind, 1 AS rank, MIN(p.created_at) AS since
      FROM public.paper_positions p
      JOIN public.paper_accounts a ON a.user_id = p.user_id AND a.generation = p.generation
      WHERE p.total_shares > 0
      GROUP BY p.exchange, p.symbol
    ) interest
    ORDER BY rank, since, exchange, symbol
  `);
  return rows.map((row) => ({ exchange: row.exchange, symbol: row.symbol, kind: row.kind }));
}

export interface PaperInterestLog {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  debug: (fields: Record<string, unknown>, message: string) => void;
}

export interface PaperInterestSubscriptionsOptions {
  subscribe: (symbol: string) => void;
  unsubscribe: (symbol: string) => void;
  fetchInterest?: () => Promise<PaperInterestRow[]>;
  /** Most symbols this source may hold (the shared stream cap). */
  maxSymbols?: number;
  intervalMs?: number;
  log: PaperInterestLog;
}

export class PaperInterestSubscriptions {
  private readonly owned = new Set<string>();
  private readonly fetchInterest: () => Promise<PaperInterestRow[]>;
  private readonly maxSymbols: number;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;
  private stopped = false;
  /** Incremented by stop(); a query that started before a stop is discarded. */
  private epoch = 0;
  private lastSkippedKey = "";
  private lastDroppedKey = "";

  constructor(private readonly options: PaperInterestSubscriptionsOptions) {
    this.fetchInterest = options.fetchInterest ?? listPaperInterest;
    this.maxSymbols = options.maxSymbols ?? MAX_STREAM_SYMBOLS;
    this.intervalMs = options.intervalMs ?? PAPER_INTEREST_REFRESH_MS;
  }

  /** Reconciles now and then every `intervalMs`. */
  start(): void {
    this.stopped = false;
    this.requestRefresh();
    this.timer ??= setInterval(() => this.requestRefresh(), this.intervalMs);
  }

  /** Stops refreshing and releases every symbol this source holds. */
  stop(): void {
    this.stopped = true;
    this.epoch++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.rerun = false;
    for (const symbol of this.owned) this.options.unsubscribe(symbol);
    this.owned.clear();
  }

  /**
   * Asks for a reconcile (an order was placed, cancelled or filled). Requests
   * that arrive while one runs collapse into a single follow-up query.
   */
  requestRefresh(): void {
    if (this.stopped) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    void this.reconcile();
  }

  /** Resolves once no reconcile is running or queued. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Symbols this source currently holds a subscription reference for. */
  symbols(): string[] {
    return [...this.owned];
  }

  reconcile(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.reconcileLoop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async reconcileLoop(): Promise<void> {
    do {
      this.rerun = false;
      await this.reconcileOnce();
    } while (this.rerun && !this.stopped);
  }

  private async reconcileOnce(): Promise<void> {
    const epoch = this.epoch;
    let rows: PaperInterestRow[];
    try {
      // Through the breaker: while the database is down this costs nothing and
      // the current subscriptions stay as they are.
      rows = await withOptionalDatabase(this.fetchInterest);
    } catch (error) {
      if (!(error instanceof DatabaseUnavailableError)) {
        this.options.log.warn(
          { err: error instanceof Error ? error.message : String(error) },
          "paper interest query failed; keeping current live-feed subscriptions"
        );
      }
      return;
    }
    if (epoch !== this.epoch) return;
    this.apply(rows);
  }

  private apply(rows: PaperInterestRow[]): void {
    const wanted: string[] = [];
    const seen = new Set<string>();
    const skipped = new Set<string>();
    // Working orders first: without ticks they cannot fill at all.
    const prioritised = [...rows.filter((row) => row.kind === "ORDER"), ...rows.filter((row) => row.kind !== "ORDER")];
    for (const row of prioritised) {
      const exchange = row.exchange.trim().toUpperCase();
      const symbol = row.symbol.trim().toUpperCase();
      if (STREAMED_EXCHANGES[exchange] !== true) {
        skipped.add(`${exchange}:${symbol}`);
        continue;
      }
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      wanted.push(symbol);
    }

    const skippedKey = [...skipped].sort().join(",");
    if (skippedKey !== this.lastSkippedKey && skipped.size > 0) {
      this.options.log.warn(
        { count: skipped.size, symbols: [...skipped].slice(0, 20) },
        "paper orders/positions on BSE get no live ticks: the live feed streams NSE only"
      );
    }
    this.lastSkippedKey = skippedKey;

    const kept = wanted.slice(0, this.maxSymbols);
    const dropped = wanted.slice(this.maxSymbols);
    const droppedKey = dropped.join(",");
    if (droppedKey !== this.lastDroppedKey && dropped.length > 0) {
      this.options.log.warn(
        { cap: this.maxSymbols, wanted: wanted.length, dropped: dropped.slice(0, 20) },
        "paper interest exceeds the live-feed symbol cap; working orders kept ahead of positions"
      );
    }
    this.lastDroppedKey = droppedKey;

    const next = new Set(kept);
    for (const symbol of next) {
      if (!this.owned.has(symbol)) {
        this.options.subscribe(symbol);
        this.owned.add(symbol);
      }
    }
    for (const symbol of [...this.owned]) {
      if (!next.has(symbol)) {
        this.options.unsubscribe(symbol);
        this.owned.delete(symbol);
      }
    }
  }
}
