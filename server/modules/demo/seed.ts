/**
 * Writes the synthetic demo dataset into the database the shared client points at.
 *
 * - DEMO- companies, their daily candles (server/modules/demo/generator.ts) and a latest quote
 *   snapshot, all marked source "synthetic-demo" / "simulated".
 * - A demo user with a paper account and a few market fills. The fills go through the real paper
 *   fill writer (applyFill) against quotes labelled source "simulated", quality "synthetic"; only
 *   the quote policy differs from live trading (synthetic, historical quotes are accepted).
 * - Saved screener definitions in the Screener's own criteria format.
 * - A strategy, its frozen version and a COMPLETED backtest job produced by the real backtest job
 *   (runBacktestJob: candle loading, runner-v3, persistence) over the seeded candles.
 *
 * Idempotent: every run first deletes the previous demo rows (the demo user cascades its own data;
 * companies and candles are matched by demo symbol AND synthetic source), then writes them again.
 * Callers choose the database; see server/scripts/seed-demo.ts for the production guard.
 */

import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Candle, ExecutionQuote, ExecutionQuotePolicyConfig } from "@shared/types";
import { db, getSqlClient } from "../../data/drizzle/client";
import {
  candles as candlesTable,
  companies,
  quoteSnapshots,
  savedScreenerDefinitions,
  strategyBacktestJobs,
  strategyDefinitions,
  strategyVersions,
  paperAccounts,
  paperLedgerEntries,
  users,
} from "../../db/schema";
import { canonicalDefinitionJson, validateAst, type StrategyDefinition } from "../../../shared/strategy/ast";
import { STRATEGY_ENGINE_VERSION } from "../../../shared/strategy/version";
import { INDICATOR_ENGINE_VERSION } from "../../../shared/indicators/canonical";
import { withSerializablePaperTransaction } from "../paper-trading/transaction-retry";
import { applyFill } from "../paper-trading/fill-writer";
import { computeQuoteFingerprint } from "../paper-trading/quote-fingerprint";
import { buildOrderAcceptedEvent } from "../paper-trading/outbox";
import { uninterruptedJobContext } from "../strategy-jobs/job-context";
import type { BacktestJobRow } from "../strategy-jobs/repository";
import { runBacktestJob } from "../../workers/backtest-worker";
import { bundledNseHolidays, tradingDaysBetween } from "./calendar";
import { generateDemoSeries } from "./generator";
import { DEMO_COMPANIES, DEMO_DATA_SOURCE, DEMO_FROM, DEMO_SEED, DEMO_TO } from "./universe";

export const DEMO_USER_ID = "de300000-0000-4000-8000-000000000001";
export const DEMO_USER_EMAIL = "demo@maet.invalid";
export const DEMO_STRATEGY_ID = "de300000-0000-4000-8000-000000000101";
export const DEMO_STRATEGY_VERSION_ID = "de300000-0000-4000-8000-000000000102";
export const DEMO_BACKTEST_JOB_ID = "de300000-0000-4000-8000-000000000103";
const DEMO_WORKER_ID = "demo-seed";
const DEMO_INITIAL_CASH = 1_000_000;
const DEMO_SYMBOLS = DEMO_COMPANIES.map((company) => company.symbol);
const BACKTEST_SYMBOL = "DEMO-CHIT";
/** Demo fills price at the last minutes of the session (15:25 IST). */
const FILL_TIME_UTC = "T09:55:00.000Z";

/**
 * Seeded quotes are synthetic and historical by construction. Live paper trading keeps
 * paperExecutionPolicy(), which rejects both.
 */
const DEMO_FILL_POLICY: ExecutionQuotePolicyConfig = {
  allowSynthetic: true,
  allowDelayed: false,
  maxAgeMs: Number.POSITIVE_INFINITY,
};

/** Market orders the demo user placed: `sessionsBeforeEnd` counts back from the last demo session. */
const DEMO_TRADES: ReadonlyArray<{ symbol: string; side: "BUY" | "SELL"; qty: number; sessionsBeforeEnd: number }> = [
  { symbol: "DEMO-ARKA", side: "BUY", qty: 400, sessionsBeforeEnd: 12 },
  { symbol: "DEMO-BHAV", side: "BUY", qty: 50, sessionsBeforeEnd: 9 },
  { symbol: "DEMO-ARKA", side: "SELL", qty: 150, sessionsBeforeEnd: 6 },
  { symbol: "DEMO-NIRA", side: "BUY", qty: 200, sessionsBeforeEnd: 3 },
];

/** Criteria use the Screener's saved format (SavedScreenerCriteriaV1 in src/routes/_app.screener.tsx). */
const DEMO_SCREENS = [
  {
    name: "Demo · momentum leaders",
    description: "Synthetic demo data: DEMO- symbols that closed up on the day.",
    isPinned: true,
    criteria: { schemaVersion: 1, filters: { change_pct_min: "0" }, view: "performance", sortBy: "change_pct", sortDir: "desc", hiddenColumns: [] },
  },
  {
    name: "Demo · priced above ₹500",
    description: "Synthetic demo data: higher-priced DEMO- symbols, largest first.",
    isPinned: false,
    criteria: { schemaVersion: 1, filters: { price_min: "500" }, view: "overview", sortBy: "market_cap", sortDir: "desc", hiddenColumns: [] },
  },
  {
    name: "Demo · oversold (RSI below 40)",
    description: "Synthetic demo data: DEMO- symbols with a weak 14-day RSI.",
    isPinned: false,
    criteria: { schemaVersion: 1, filters: { rsi_max: "40" }, view: "technicals", sortBy: "change_pct", sortDir: "asc", hiddenColumns: [] },
  },
] as const;

const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
const DEMO_STRATEGY: StrategyDefinition = {
  name: "Demo SMA 10/30 crossover",
  description: "Long when the 10-day SMA crosses above the 30-day SMA; flat when it crosses back. Synthetic demo data.",
  direction: "LONG_ONLY",
  entry: { kind: "GROUP", id: "entry", combinator: "AND", children: [{ kind: "CONDITION", id: "entry-cross", left: sma(10), operator: "CROSS_ABOVE", right: sma(30) }] },
  exit: { kind: "GROUP", id: "exit", combinator: "AND", children: [{ kind: "CONDITION", id: "exit-cross", left: sma(10), operator: "CROSS_BELOW", right: sma(30) }] },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 95, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5, initialCapital: DEMO_INITIAL_CASH },
};

export interface DemoSeedSummary {
  symbols: string[];
  barsPerSymbol: number;
  fills: number;
  backtestJobId: string;
  backtestTrades: number;
  backtestDataHash: string;
}

/** Bars for every demo company, generated on the bundled NSE calendar. */
export function generateDemoUniverse(): Map<string, Candle[]> {
  const days = tradingDaysBetween(DEMO_FROM, DEMO_TO, bundledNseHolidays());
  return new Map(DEMO_COMPANIES.map((company) => [company.symbol, generateDemoSeries(company, DEMO_SEED, days).candles]));
}

function marketCapBucket(marketCap: number): string {
  if (marketCap >= 200_000_000_000) return "large";
  if (marketCap >= 50_000_000_000) return "mid";
  if (marketCap >= 5_000_000_000) return "small";
  return "micro";
}

/** Removes every row a previous seed wrote. Refuses to touch a non-demo user that took the demo id. */
async function deletePreviousDemo(): Promise<void> {
  const [existing] = await db.select({ email: users.email }).from(users).where(eq(users.id, DEMO_USER_ID));
  if (existing && existing.email !== DEMO_USER_EMAIL) {
    throw new Error(`User ${DEMO_USER_ID} exists with email ${existing.email}; it is not the demo user, refusing to delete it`);
  }
  const sql = getSqlClient();
  await sql.begin(async (tx) => {
    // paper_fills and paper_ledger_entries are append-only (migration 0012); this transaction-local
    // setting is the trigger's own escape hatch, needed to cascade-delete the demo user's history.
    await tx`SELECT set_config('maet.allow_history_mutation', 'true', true)`;
    // The demo user's paper account, orders, fills, screens, strategies and jobs cascade from it.
    await tx`DELETE FROM public.users WHERE id = ${DEMO_USER_ID}`;
    await tx`DELETE FROM auth.users WHERE id = ${DEMO_USER_ID}`;
    await tx`DELETE FROM public.candles WHERE symbol IN ${tx(DEMO_SYMBOLS)} AND source = ${DEMO_DATA_SOURCE}`;
    // Quote snapshots cascade from their company.
    await tx`DELETE FROM public.companies WHERE id IN ${tx(DEMO_SYMBOLS)} AND data_source = ${DEMO_DATA_SOURCE}`;
  });
}

async function insertMarketData(universe: Map<string, Candle[]>): Promise<void> {
  await db.transaction(async (tx) => {
    for (const company of DEMO_COMPANIES) {
      const bars = universe.get(company.symbol)!;
      const last = bars[bars.length - 1];
      const previous = bars[bars.length - 2];
      const marketCap = last.close * company.sharesOutstanding;
      await tx.insert(companies).values({
        id: company.symbol,
        symbol: company.symbol,
        name: company.name,
        exchange: "NSE",
        series: "EQ",
        sector: company.sector,
        industry: company.industry,
        exchangePrimary: "NSE",
        marketCapBucket: marketCapBucket(marketCap),
        marketCap: marketCap.toFixed(2),
        isActive: true,
        dataSource: DEMO_DATA_SOURCE,
      });
      await tx.insert(quoteSnapshots).values({
        companyId: company.symbol,
        price: last.close.toFixed(4),
        changePct: (((last.close - previous.close) / previous.close) * 100).toFixed(4),
        volume: last.volume,
        marketCap: marketCap.toFixed(2),
        asOf: new Date(`${last.ts.slice(0, 10)}T10:00:00.000Z`), // 15:30 IST close of the last session
        source: "simulated",
      });
      for (let i = 0; i < bars.length; i += 500) {
        await tx.insert(candlesTable).values(
          bars.slice(i, i + 500).map((bar) => ({
            symbol: bar.symbol,
            timeframe: bar.tf,
            ts: new Date(bar.ts),
            open: bar.open.toFixed(4),
            high: bar.high.toFixed(4),
            low: bar.low.toFixed(4),
            close: bar.close.toFixed(4),
            volume: bar.volume,
            source: DEMO_DATA_SOURCE,
          })),
        );
      }
    }
  });
}

/**
 * The demo user, its saved screens, and its paper account opened on the first demo session: the
 * same account and INITIAL_CASH ledger rows createAccountIfMissing (paper-trading/postgres-repository)
 * writes, dated before the historical fills instead of at seeding time.
 */
async function insertDemoUser(opened: Date): Promise<void> {
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${DEMO_USER_ID})`;
  await db.insert(users).values({ id: DEMO_USER_ID, email: DEMO_USER_EMAIL, displayName: "Demo user (synthetic data)" });
  await db.insert(savedScreenerDefinitions).values(
    DEMO_SCREENS.map((screen) => ({ userId: DEMO_USER_ID, universe: "NSE", ...screen, criteria: { ...screen.criteria } })),
  );
  const cash = DEMO_INITIAL_CASH.toFixed(4);
  await db.insert(paperAccounts).values({
    userId: DEMO_USER_ID,
    cashBalance: cash,
    initialCash: cash,
    realisedPnl: "0.0000",
    currency: "INR",
    status: "ACTIVE",
    generation: 1,
    version: 1,
    createdAt: opened,
    updatedAt: opened,
  });
  await db.insert(paperLedgerEntries).values({
    userId: DEMO_USER_ID,
    generation: 1,
    fillId: null,
    entryType: "INITIAL_CASH",
    amount: cash,
    balanceAfter: cash,
    currency: "INR",
    sourceType: "ACCOUNT_OPEN",
    sourceId: "open:1",
    metadata: { generation: 1 },
    createdAt: opened,
  });
}

/** One MARKET order filled through the real fill writer at the session's synthetic close. */
async function placeDemoFill(trade: (typeof DEMO_TRADES)[number], bar: Candle, sequence: number): Promise<void> {
  const fillTime = new Date(`${bar.ts.slice(0, 10)}${FILL_TIME_UTC}`);
  const quote: ExecutionQuote = {
    exchange: "NSE",
    symbol: trade.symbol,
    price: bar.close,
    volume: bar.volume,
    ts: fillTime.toISOString(),
    source: "simulated",
    quality: "synthetic",
  };
  const quoteFingerprint = computeQuoteFingerprint(quote);
  await withSerializablePaperTransaction(async (repos) => {
    const account = await repos.write.ensureAccountForUpdate({ userId: DEMO_USER_ID, initialCash: DEMO_INITIAL_CASH });
    const positions = await repos.write.findPositionsForUpdate({ userId: DEMO_USER_ID, generation: account.generation });
    const order = await repos.write.insertOrder({
      id: randomUUID(),
      userId: DEMO_USER_ID,
      idempotencyKey: `demo-seed-${sequence}`,
      clientOrderId: null,
      symbol: trade.symbol,
      exchange: "NSE",
      side: trade.side,
      type: "MARKET",
      qty: trade.qty,
      limitPrice: null,
      stopPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      generation: account.generation,
      status: "PENDING",
      filledQty: 0,
      quoteSource: quote.source,
      quoteQuality: quote.quality,
      quoteTimestamp: fillTime,
      referencePrice: String(quote.price),
      version: 1,
      placedAt: fillTime,
      updatedAt: fillTime,
    });
    await applyFill({
      write: repos.write,
      account,
      order,
      positions,
      quote,
      quoteFingerprint,
      fillQuantity: trade.qty,
      reason: "USER_ORDER",
      ledgerSourceType: "FILL",
      markFor: () => undefined,
      now: fillTime,
      createId: randomUUID,
      policy: DEMO_FILL_POLICY,
    });
    await repos.write.insertOutboxEvents([
      buildOrderAcceptedEvent({
        userId: DEMO_USER_ID,
        generation: account.generation,
        aggregateType: "PaperOrder",
        aggregateId: order.id,
        payload: { orderId: order.id },
      }),
    ]);
  });
}

async function insertStrategyVersion(): Promise<void> {
  const validation = validateAst(DEMO_STRATEGY);
  if (!validation.valid) throw new Error(`Demo strategy is invalid: ${validation.errors.map((e) => e.message).join("; ")}`);
  await db.insert(strategyDefinitions).values({
    id: DEMO_STRATEGY_ID,
    userId: DEMO_USER_ID,
    name: DEMO_STRATEGY.name,
    description: DEMO_STRATEGY.description,
    status: "VALIDATED",
    currentDraft: DEMO_STRATEGY,
  });
  // Frozen exactly as strategy-definitions/service.ts createVersion freezes a draft.
  await db.insert(strategyVersions).values({
    id: DEMO_STRATEGY_VERSION_ID,
    strategyId: DEMO_STRATEGY_ID,
    userId: DEMO_USER_ID,
    versionNumber: 1,
    definition: DEMO_STRATEGY,
    definitionHash: createHash("sha256").update(canonicalDefinitionJson(DEMO_STRATEGY)).digest("hex"),
    engineVersion: STRATEGY_ENGINE_VERSION,
    indicatorVersion: INDICATOR_ENGINE_VERSION,
    schemaVersion: 1,
  });
}

/** Runs the real backtest job over the seeded candles and returns its persisted outcome. */
async function runDemoBacktest(bars: Candle[]): Promise<{ trades: number; dataHash: string }> {
  const now = new Date();
  const [job] = await db
    .insert(strategyBacktestJobs)
    .values({
      id: DEMO_BACKTEST_JOB_ID,
      userId: DEMO_USER_ID,
      strategyVersionId: DEMO_STRATEGY_VERSION_ID,
      // Claimed by this process up front so a job runner sharing the database never picks it up.
      status: "RUNNING",
      symbolOrUniverse: BACKTEST_SYMBOL,
      timeframe: "1d",
      fromDate: new Date(bars[0].ts),
      toDate: new Date(bars[bars.length - 1].ts),
      initialCapital: String(DEMO_INITIAL_CASH),
      progress: 0,
      workerId: DEMO_WORKER_ID,
      startedAt: now,
      heartbeatAt: now,
    })
    .returning();
  await runBacktestJob(job as unknown as BacktestJobRow, DEMO_WORKER_ID, uninterruptedJobContext);

  const sql = getSqlClient();
  const [outcome] = await sql<{ status: string; error_summary: string | null; trade_count: number | null; data_hash: string | null }[]>`
    SELECT j.status, j.error_summary, p.trade_count, p.data_hash
    FROM public.strategy_backtest_jobs j
    LEFT JOIN public.strategy_performance_snapshots p ON p.job_id = j.id
    WHERE j.id = ${DEMO_BACKTEST_JOB_ID}`;
  if (outcome?.status !== "COMPLETED" || outcome.data_hash === null) {
    throw new Error(`Demo backtest did not complete (${outcome?.status ?? "missing"}): ${outcome?.error_summary ?? "no snapshot"}`);
  }
  return { trades: outcome.trade_count ?? 0, dataHash: outcome.data_hash };
}

export async function seedDemo(): Promise<DemoSeedSummary> {
  const universe = generateDemoUniverse();
  await deletePreviousDemo();
  await insertMarketData(universe);
  await insertDemoUser(new Date(universe.get(BACKTEST_SYMBOL)![0].ts));

  for (const [index, trade] of DEMO_TRADES.entries()) {
    const bars = universe.get(trade.symbol)!;
    await placeDemoFill(trade, bars[bars.length - 1 - trade.sessionsBeforeEnd], index + 1);
  }
  await insertStrategyVersion();
  const backtest = await runDemoBacktest(universe.get(BACKTEST_SYMBOL)!);

  return {
    symbols: DEMO_SYMBOLS,
    barsPerSymbol: universe.get(BACKTEST_SYMBOL)!.length,
    fills: DEMO_TRADES.length,
    backtestJobId: DEMO_BACKTEST_JOB_ID,
    backtestTrades: backtest.trades,
    backtestDataHash: backtest.dataHash,
  };
}

/** Rows the demo owns, per table: equal after every seed run. */
export async function countDemoRows(): Promise<Record<string, number>> {
  const sql = getSqlClient();
  const byUser = [
    "users",
    "paper_accounts",
    "paper_orders",
    "paper_fills",
    "paper_positions",
    "paper_ledger_entries",
    "paper_outbox_events",
    "saved_screener_definitions",
    "strategy_definitions",
    "strategy_versions",
    "strategy_backtest_jobs",
    "strategy_backtest_trades",
    "strategy_equity_points",
    "strategy_performance_snapshots",
  ];
  const counts: Record<string, number> = {};
  for (const table of byUser) {
    const column = table === "users" ? "id" : "user_id";
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(`public.${table}`)} WHERE ${sql(column)} = ${DEMO_USER_ID}`;
    counts[table] = row.count;
  }
  const [market] = await sql<{ companies: number; quote_snapshots: number; candles: number }[]>`
    SELECT
      (SELECT count(*)::int FROM public.companies WHERE id IN ${sql(DEMO_SYMBOLS)} AND data_source = ${DEMO_DATA_SOURCE}) AS companies,
      (SELECT count(*)::int FROM public.quote_snapshots WHERE company_id IN ${sql(DEMO_SYMBOLS)}) AS quote_snapshots,
      (SELECT count(*)::int FROM public.candles WHERE symbol IN ${sql(DEMO_SYMBOLS)} AND source = ${DEMO_DATA_SOURCE}) AS candles`;
  return { ...counts, ...market };
}
