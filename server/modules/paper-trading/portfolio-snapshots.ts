/**
 * Daily snapshots of paper accounts: the server-side equity curve.
 *
 * One row per (user, account generation, IST trading date). A row is written
 * after the NSE close by the in-process scheduler, or on demand when the
 * account's analytics are read and the current session has no row yet. An
 * intraday (on-read) row is provisional: the first write after the close
 * replaces it. A final row is rewritten only to replace stale prices with a
 * valuation that has none; otherwise it is never rewritten.
 *
 * Values: cash from the account row; realised P&L and fees summed from the
 * generation's ledger; open positions marked at the last known price, whose
 * source is recorded. A price that is not from the session (for a final
 * snapshot: not from its closing window), a stale/synthetic quote, or no
 * price at all (the entry price is used) marks the snapshot stale_prices
 * instead of being presented as a close.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { calculateMarkedUnrealisedPnl } from "@shared/domain/paper-trading/margin";
import { getDb } from "../../data/drizzle/client";
import { paperAccounts, paperLedgerEntries, paperPortfolioSnapshots, paperPositions } from "../../db/schema";
import { computePhase, istClock, istDateKey } from "../../domain/market/clock";
import { configuredHolidays } from "../../domain/market/quote-quality";
import { loadQuote } from "../../domain/market/quote-service";
import { quoteStore } from "../../domain/market/quote-store";
import { getLogger } from "../../infra/logger";
import type { PaperAccountRow, PaperPositionRow } from "./contracts";
import type { PaperDatabase } from "./repository";
import { signedPositionQuantity } from "./mapper";
import { computePortfolioMetrics, type CurveAnchor } from "./portfolio-metrics";
import type {
  OnDemandSnapshotStatus,
  PortfolioAnalyticsResult,
  PortfolioCurvePoint,
} from "./portfolio-analytics-contracts";

const SESSION_OPEN_IST_MINUTES = 9 * 60 + 15;
const SESSION_CLOSE_IST_MINUTES = 15 * 60 + 30;
/**
 * Start of the NSE cash-market closing window. NSE's official closing price is
 * the volume-weighted average of trades in the last 30 minutes (15:00-15:30
 * IST), so a final snapshot needs a price from this window or later in the
 * same session. Last-trade timestamps fall just before 15:30 (e.g. 15:29:59),
 * which is why the threshold is not the 15:30 close itself.
 */
export const CLOSING_WINDOW_START_IST_MINUTES = 15 * 60;
/** Closing prices settle (and the closing auction prints) shortly after 15:30 IST. */
export const SNAPSHOT_CLOSE_BUFFER_MINUTES = 15;
export const END_OF_DAY_SNAPSHOT_IST_MINUTES = SESSION_CLOSE_IST_MINUTES + SNAPSHOT_CLOSE_BUFFER_MINUTES;
/** Postgres advisory lock key: one end-of-day run at a time across instances. */
export const END_OF_DAY_LOCK_KEY = "paper-portfolio-snapshots:eod";
const SNAPSHOT_ACCOUNT_STATUSES = ["ACTIVE", "LIQUIDATION_PENDING"] as const;
const DAY_MS = 86_400_000;

export type SnapshotRow = typeof paperPortfolioSnapshots.$inferSelect;
type NewSnapshotRow = typeof paperPortfolioSnapshots.$inferInsert;
type Exchange = "NSE" | "BSE";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** True when `date` (IST, YYYY-MM-DD) is an NSE trading day: a weekday that is not a holiday. */
export function isTradingDate(date: string, holidays: Date[]): boolean {
  // 12:00 IST that day is OPEN on a trading day, CLOSED on a weekend, HOLIDAY on a holiday.
  return computePhase(new Date(`${date}T06:30:00.000Z`), holidays) === "OPEN";
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** The instant of an IST wall-clock time (minutes after midnight) on `date`. */
function istInstant(date: string, minutes: number): number {
  return Date.parse(`${date}T00:00:00.000+05:30`) + minutes * 60_000;
}

/** Trading sessions in (fromExclusive, toInclusive] on the NSE calendar. */
export function tradingSessionsBetween(fromExclusive: string, toInclusive: string, holidays: Date[]): number {
  let count = 0;
  for (let time = Date.parse(`${fromExclusive}T00:00:00.000Z`) + DAY_MS; time <= Date.parse(`${toInclusive}T00:00:00.000Z`); time += DAY_MS) {
    if (isTradingDate(new Date(time).toISOString().slice(0, 10), holidays)) count++;
  }
  return count;
}

export interface SnapshotSession {
  /** IST date of the session a snapshot taken now describes. */
  date: string;
  /** The session has closed (plus buffer): a snapshot of it is final. */
  isFinal: boolean;
}

/**
 * The session a snapshot at `now` values: today's once it has opened (final
 * from 15:45 IST), otherwise the latest completed trading session.
 */
export function snapshotSessionFor(now: Date, holidays: Date[]): SnapshotSession {
  const today = istDateKey(now);
  const { minutes } = istClock(now);
  if (isTradingDate(today, holidays) && minutes >= SESSION_OPEN_IST_MINUTES) {
    return { date: today, isFinal: minutes >= END_OF_DAY_SNAPSHOT_IST_MINUTES };
  }
  let date = previousDate(today);
  for (let i = 0; i < 31 && !isTradingDate(date, holidays); i++) date = previousDate(date);
  return { date, isFinal: true };
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

export interface SnapshotPrice {
  price: number;
  /** ISO timestamp of the price. */
  ts: string;
  source: string;
  quality: string;
}

export type SnapshotPriceLoader = (exchange: Exchange, symbol: string) => Promise<SnapshotPrice | null>;

/** Market-data layer quote (stream tick, broker REST, then Yahoo), else the last streamed tick. */
export const loadSnapshotPrice: SnapshotPriceLoader = async (exchange, symbol) => {
  try {
    const quote = await loadQuote(symbol);
    if (quote.exchange === exchange) return quote;
  } catch {
    // Fall back to whatever the stream last delivered.
  }
  const streamed = quoteStore.get(symbol);
  return streamed && streamed.exchange === exchange ? streamed : null;
};

export interface PositionValuation {
  symbol: string;
  exchange: string;
  side: "LONG" | "SHORT";
  quantity: number;
  averageEntryPrice: number;
  price: number;
  /** Provider of the price; "last_fill:<provider>" for the position's last fill quote; "entry_price" when none. */
  source: string;
  quality: string | null;
  asOf: string | null;
  stale: boolean;
  marketValue: number;
  unrealizedPnl: number;
}

const UNTRUSTED_QUALITIES: Record<string, true> = { stale: true, synthetic: true };

function priceCandidate(price: number | null, ts: string | null, source: string, quality: string | null) {
  if (price === null || !Number.isFinite(price) || price <= 0 || ts === null) return null;
  const time = Date.parse(ts);
  return Number.isFinite(time) ? { price, ts: new Date(time).toISOString(), time, source, quality } : null;
}

/**
 * Marks one position at the most recent known price and says whether that
 * price can stand for the session: from the session's date, and for a final
 * snapshot from its closing window or later.
 */
export function valuePosition(
  position: PaperPositionRow,
  quote: SnapshotPrice | null,
  session: SnapshotSession
): PositionValuation {
  const quantity = signedPositionQuantity(position);
  const averageEntryPrice = Number(position.averageEntryPrice);
  const candidates = [
    quote ? priceCandidate(quote.price, quote.ts, quote.source, quote.quality) : null,
    priceCandidate(
      position.lastQuotePrice === null ? null : Number(position.lastQuotePrice),
      position.lastQuoteTimestamp?.toISOString() ?? null,
      `last_fill:${position.lastQuoteSource ?? "unknown"}`,
      position.lastQuoteQuality
    ),
  ].filter((candidate) => candidate !== null);
  // Most recent price wins; the live quote wins a tie.
  const chosen = candidates.reduce<(typeof candidates)[number] | null>(
    (best, candidate) => (best === null || candidate.time > best.time ? candidate : best),
    null
  );

  const price = chosen?.price ?? averageEntryPrice;
  const stale =
    chosen === null ||
    istDateKey(new Date(chosen.time)) !== session.date ||
    (session.isFinal && chosen.time < istInstant(session.date, CLOSING_WINDOW_START_IST_MINUTES)) ||
    (chosen.quality !== null && UNTRUSTED_QUALITIES[chosen.quality] === true);
  return {
    symbol: position.symbol,
    exchange: position.exchange,
    side: quantity < 0 ? "SHORT" : "LONG",
    quantity: Math.abs(quantity),
    averageEntryPrice,
    price,
    source: chosen?.source ?? "entry_price",
    quality: chosen?.quality ?? null,
    asOf: chosen?.ts ?? null,
    stale,
    marketValue: round4(Math.abs(quantity) * price),
    unrealizedPnl: round4(calculateMarkedUnrealisedPnl({ quantity, averagePrice: averageEntryPrice }, price)),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function money(value: number): string {
  return round4(value).toFixed(4);
}

export interface AccountLedgerTotals {
  realizedPnl: number;
  fees: number;
}

export interface AccountValuation {
  cash: number;
  initialCash: number;
  realizedPnl: number;
  fees: number;
  positionsMarketValue: number;
  unrealizedPnl: number;
  equity: number;
  stalePrices: boolean;
  priceSource: string;
  positions: PositionValuation[];
}

/** Equity = cash + unrealised P&L: paper positions are margined, so cash moves only by realised P&L and fees. */
export function valueAccount(
  account: Pick<PaperAccountRow, "cashBalance" | "initialCash">,
  ledger: AccountLedgerTotals,
  positions: PositionValuation[]
): AccountValuation {
  const cash = Number(account.cashBalance);
  const unrealizedPnl = round4(positions.reduce((sum, position) => sum + position.unrealizedPnl, 0));
  const sources = [...new Set(positions.map((position) => position.source))].sort();
  return {
    cash,
    initialCash: Number(account.initialCash),
    realizedPnl: ledger.realizedPnl,
    fees: ledger.fees,
    positionsMarketValue: round4(positions.reduce((sum, position) => sum + position.marketValue, 0)),
    unrealizedPnl,
    equity: round4(cash + unrealizedPnl),
    stalePrices: positions.some((position) => position.stale),
    priceSource: sources.length === 0 ? "none" : sources.join(","),
    positions,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type CaptureStatus = "written" | "unchanged" | "no_account" | "generation_not_started";

export interface CaptureResult {
  status: CaptureStatus;
  session: SnapshotSession;
  snapshot: SnapshotRow | null;
}

export interface EndOfDayRunResult {
  status: "session_open" | "locked" | "ran";
  date: string;
  written: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface PaperPortfolioSnapshotDependencies {
  database?: PaperDatabase;
  loadPrice?: SnapshotPriceLoader;
  holidays?: () => Date[];
  now?: () => Date;
}

interface AccountState {
  account: PaperAccountRow;
  positions: PaperPositionRow[];
  ledger: AccountLedgerTotals;
}

function log() {
  return getLogger().child({ module: "paper-portfolio-snapshots" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toCurvePoint(row: SnapshotRow): PortfolioCurvePoint {
  return {
    date: row.snapshotDate,
    equity: Number(row.equity),
    cash: Number(row.cashBalance),
    positionsMarketValue: Number(row.positionsMarketValue),
    realizedPnl: Number(row.realizedPnl),
    unrealizedPnl: Number(row.unrealizedPnl),
    feesToDate: Number(row.feesToDate),
    positionsCount: row.positionsCount,
    stalePrices: row.stalePrices,
    priceSource: row.priceSource,
    isFinal: row.isFinal,
    capturedAt: row.snapshotTime.toISOString(),
  };
}

export class PaperPortfolioSnapshotService {
  private readonly database: () => PaperDatabase;
  private readonly loadPrice: SnapshotPriceLoader;
  private readonly holidays: () => Date[];
  private readonly now: () => Date;

  constructor(deps: PaperPortfolioSnapshotDependencies = {}) {
    this.database = deps.database ? () => deps.database! : () => getDb();
    this.loadPrice = deps.loadPrice ?? loadSnapshotPrice;
    this.holidays = deps.holidays ?? configuredHolidays;
    this.now = deps.now ?? (() => new Date());
  }

  sessionFor(now: Date = this.now()): SnapshotSession {
    return snapshotSessionFor(now, this.holidays());
  }

  /** Account, current-generation positions and ledger totals, read from one database snapshot. */
  private async readAccountState(userId: string): Promise<AccountState | null> {
    return this.database().transaction(
      async (tx) => {
        const [account] = await tx.select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
        if (!account) return null;
        const positions = await tx
          .select()
          .from(paperPositions)
          .where(and(eq(paperPositions.userId, userId), eq(paperPositions.generation, account.generation)))
          .orderBy(asc(paperPositions.exchange), asc(paperPositions.symbol));
        const [totals] = await tx
          .select({
            realized: sql<string>`coalesce(sum(${paperLedgerEntries.amount}) filter (where ${paperLedgerEntries.entryType} = 'TRADE_REALIZED_PNL'), 0)`,
            fees: sql<string>`coalesce(-sum(${paperLedgerEntries.amount}) filter (where ${paperLedgerEntries.entryType} = 'EXECUTION_FEE'), 0)`,
          })
          .from(paperLedgerEntries)
          .where(and(eq(paperLedgerEntries.userId, userId), eq(paperLedgerEntries.generation, account.generation)));
        return {
          account,
          positions: positions.filter((position) => position.totalShares > 0),
          ledger: { realizedPnl: Number(totals?.realized ?? 0), fees: Number(totals?.fees ?? 0) },
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" }
    );
  }

  /**
   * Values the account now and writes the snapshot of the current session for
   * its current generation. Idempotent per (user, generation, date): a final
   * snapshot is never rewritten; a provisional one is replaced.
   */
  async captureAccount(
    userId: string,
    options: { now?: Date; capturedBy: "SCHEDULER" | "ON_READ" }
  ): Promise<CaptureResult> {
    const now = options.now ?? this.now();
    const session = this.sessionFor(now);
    const state = await this.readAccountState(userId);
    if (!state) return { status: "no_account", session, snapshot: null };

    const { account, positions, ledger } = state;
    // A generation has no history for sessions that closed before it began (account creation or reset).
    if ((account.resetAt ?? account.createdAt).getTime() > istInstant(session.date, SESSION_CLOSE_IST_MINUTES)) {
      return { status: "generation_not_started", session, snapshot: null };
    }

    const quotes = await Promise.all(
      positions.map((position) =>
        this.loadPrice(position.exchange === "BSE" ? "BSE" : "NSE", position.symbol).catch(() => null)
      )
    );
    const valuation = valueAccount(
      account,
      ledger,
      positions.map((position, index) => valuePosition(position, quotes[index] ?? null, session))
    );

    const ledgerCash = valuation.initialCash + valuation.realizedPnl - valuation.fees;
    if (Math.abs(ledgerCash - valuation.cash) > 0.01) {
      log().warn(
        { userId, generation: account.generation, cash: valuation.cash, ledgerCash },
        "paper account cash does not reconcile with its ledger"
      );
    }

    const values = {
      initialCash: money(valuation.initialCash),
      cashBalance: money(valuation.cash),
      positionsMarketValue: money(valuation.positionsMarketValue),
      equity: money(valuation.equity),
      realizedPnl: money(valuation.realizedPnl),
      unrealizedPnl: money(valuation.unrealizedPnl),
      feesToDate: money(valuation.fees),
      marginUsed: account.allocatedMargin,
      positionsCount: positions.length,
      stalePrices: valuation.stalePrices,
      priceSource: valuation.priceSource,
      positionPrices: valuation.positions,
      isFinal: session.isFinal,
      capturedBy: options.capturedBy,
      snapshotTime: now,
    } satisfies Partial<NewSnapshotRow>;

    const [written] = await this.database()
      .insert(paperPortfolioSnapshots)
      .values({ userId, generation: account.generation, snapshotDate: session.date, ...values })
      .onConflictDoUpdate({
        target: [paperPortfolioSnapshots.userId, paperPortfolioSnapshots.generation, paperPortfolioSnapshots.snapshotDate],
        set: values,
        // Replace a provisional row, or a final row with stale prices by a final valuation without them.
        setWhere: sql`${paperPortfolioSnapshots.isFinal} = false OR (${paperPortfolioSnapshots.stalePrices} AND excluded.is_final AND NOT excluded.stale_prices)`,
      })
      .returning();
    if (written) return { status: "written", session, snapshot: written };

    const [existing] = await this.database()
      .select()
      .from(paperPortfolioSnapshots)
      .where(
        and(
          eq(paperPortfolioSnapshots.userId, userId),
          eq(paperPortfolioSnapshots.generation, account.generation),
          eq(paperPortfolioSnapshots.snapshotDate, session.date)
        )
      );
    return { status: "unchanged", session, snapshot: existing ?? null };
  }

  /**
   * Final snapshots of the latest closed session for every open account that
   * lacks one (or whose final one has stale prices). Holds a transaction-scoped
   * Postgres advisory lock so concurrent runs (another instance, an overlapping
   * tick) skip instead of duplicating work.
   */
  async runEndOfDay(now: Date = this.now()): Promise<EndOfDayRunResult> {
    const session = this.sessionFor(now);
    const result: EndOfDayRunResult = { status: "session_open", date: session.date, written: 0, unchanged: 0, skipped: 0, failed: 0 };
    if (!session.isFinal) return result;

    return this.database().transaction(async (tx) => {
      const [lock] = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${END_OF_DAY_LOCK_KEY})) AS locked`
      )) as unknown as Array<{ locked: boolean }>;
      if (!lock?.locked) return { ...result, status: "locked" };

      const pending = await tx
        .select({ userId: paperAccounts.userId })
        .from(paperAccounts)
        .where(
          and(
            inArray(paperAccounts.status, [...SNAPSHOT_ACCOUNT_STATUSES]),
            sql`NOT EXISTS (
              SELECT 1 FROM ${paperPortfolioSnapshots}
              WHERE ${paperPortfolioSnapshots.userId} = ${paperAccounts.userId}
                AND ${paperPortfolioSnapshots.generation} = ${paperAccounts.generation}
                AND ${paperPortfolioSnapshots.snapshotDate} = ${session.date}
                AND ${paperPortfolioSnapshots.isFinal}
                AND NOT ${paperPortfolioSnapshots.stalePrices}
            )`
          )
        );

      const ran: EndOfDayRunResult = { ...result, status: "ran" };
      for (const { userId } of pending) {
        try {
          const captured = await this.captureAccount(userId, { now, capturedBy: "SCHEDULER" });
          if (captured.status === "written") ran.written++;
          else if (captured.status === "unchanged") ran.unchanged++;
          else ran.skipped++;
        } catch (error) {
          ran.failed++;
          log().error({ userId, date: session.date, err: errorMessage(error) }, "paper portfolio snapshot failed");
        }
      }
      return ran;
    });
  }

  /**
   * Writes the current session's snapshot when it is missing, when only a
   * provisional one exists and the session has since closed, or when the
   * final one was valued with stale prices (a fresh close may now exist).
   */
  async ensureCurrentSnapshot(userId: string, now: Date = this.now()): Promise<OnDemandSnapshotStatus> {
    const session = this.sessionFor(now);
    const [account] = await this.database()
      .select({ generation: paperAccounts.generation })
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, userId));
    if (!account) return "no_account";

    const [existing] = await this.database()
      .select({ isFinal: paperPortfolioSnapshots.isFinal, stalePrices: paperPortfolioSnapshots.stalePrices })
      .from(paperPortfolioSnapshots)
      .where(
        and(
          eq(paperPortfolioSnapshots.userId, userId),
          eq(paperPortfolioSnapshots.generation, account.generation),
          eq(paperPortfolioSnapshots.snapshotDate, session.date)
        )
      );
    if (existing && (!session.isFinal || (existing.isFinal && !existing.stalePrices))) return "existing";

    const captured = await this.captureAccount(userId, { now, capturedBy: "ON_READ" });
    switch (captured.status) {
      case "written":
        return "written";
      case "unchanged":
        return "existing";
      case "no_account":
        return "no_account";
      case "generation_not_started":
        return "generation_not_started";
    }
  }

  /** The current generation's equity curve and its metrics, after an on-demand snapshot if one is due. */
  async getAnalytics(userId: string, options: { riskFreeRate?: number; now?: Date } = {}): Promise<PortfolioAnalyticsResult> {
    const now = options.now ?? this.now();
    let onDemandSnapshot: OnDemandSnapshotStatus;
    try {
      onDemandSnapshot = await this.ensureCurrentSnapshot(userId, now);
    } catch (error) {
      // The stored curve is still worth returning; the next read retries.
      log().error({ userId, err: errorMessage(error) }, "on-demand paper portfolio snapshot failed");
      onDemandSnapshot = "failed";
    }

    const [account] = await this.database().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    if (!account) {
      return {
        account: null,
        reason: "No paper trading account yet",
        anchor: null,
        curve: [],
        metrics: computePortfolioMetrics([], { riskFreeRate: options.riskFreeRate }),
        onDemandSnapshot,
        asOf: now.toISOString(),
      };
    }

    const rows = await this.database()
      .select()
      .from(paperPortfolioSnapshots)
      .where(and(eq(paperPortfolioSnapshots.userId, userId), eq(paperPortfolioSnapshots.generation, account.generation)))
      .orderBy(asc(paperPortfolioSnapshots.snapshotDate));
    const curve = rows.map(toCurvePoint);
    // The curve starts from the generation's initial cash on the day it began.
    const startedAt = account.resetAt ?? account.createdAt;
    const anchor: CurveAnchor = { date: istDateKey(startedAt), equity: Number(account.initialCash) };
    const holidays = this.holidays();
    return {
      account: { generation: account.generation, initialCash: Number(account.initialCash), status: account.status },
      reason: null,
      anchor,
      curve,
      metrics: computePortfolioMetrics(
        curve.map((point) => ({ date: point.date, equity: point.equity, stalePrices: point.stalePrices, isFinal: point.isFinal })),
        {
          riskFreeRate: options.riskFreeRate,
          anchor,
          anchorStartsAfterClose: startedAt.getTime() > istInstant(anchor.date, SESSION_CLOSE_IST_MINUTES),
          sessionsBetween: (from, to) => tradingSessionsBetween(from, to, holidays),
          currentSessionDate: this.sessionFor(now).date,
        }
      ),
      onDemandSnapshot,
      asOf: now.toISOString(),
    };
  }
}

export function createPaperPortfolioSnapshotService(
  deps: PaperPortfolioSnapshotDependencies = {}
): PaperPortfolioSnapshotService {
  return new PaperPortfolioSnapshotService(deps);
}
