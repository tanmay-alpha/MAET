/**
 * Daily Data Processor
 * Scheduled worker for historical data ingestion, fundamentals sync, and data maintenance.
 *
 * Responsibilities:
 * - Fetch and store historical candle data for tracked symbols
 * - Sync fundamental data from NSE
 * - Validate data quality and flag anomalies
 * - Run screener results cache refresh
 * - Data cleanup and archival
 */

import { getLogger } from "../infra/logger";
import { db } from "../data/drizzle/client";
import { candles, companies, fundamentals } from "../db/schema";
import { getCandles } from "../data/sources/yahoo";
import { getFundamentals as fetchNSEFundamentals } from "../data/sources/nse";
import { getNseCompanyMaster } from "../data/sources/nse-company-master";
import { resolveMarketSymbol } from "../domain/market/symbol";
import type { Candle } from "@shared/types";
import { sql } from "drizzle-orm";

export type DailyProcessorOptions = {
  /** Symbols to process. Defaults to NSE Nifty 50 constituents. */
  symbols?: string[];
  /** Timeframes to store. Defaults to 1d and 1wk. */
  timeframes?: Candle["tf"][];
  /** Max days of history to backfill per symbol per run. */
  backfillDays?: number;
  /** Whether to sync fundamentals. Default: true. */
  syncFundamentals?: boolean;
  /** Dry run: log actions without writing to DB. Default: false. */
  dryRun?: boolean;
};

// Nifty 50 default symbols
const DEFAULT_SYMBOLS = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC", "KOTAKBANK",
  "LT", "SBIN", "AXISBANK", "ASIANPAINT", "MARUTI", "BAJFINANCE", "TITAN", "NESTLEIND",
  "M&M", "SUNPHARMA", "ULTRACEMCO", "TATASTEEL", "WIPRO", "ADANIPORTS", "POWERGRID",
  "NTPC", "ONGC", "COALINDIA", "JSWSTEEL", "ADANIENT", "BRITANNIA", "CIPLA", "DRREDDY",
  "EICHERMOT", "GRASIM", "HCLTECH", "HEROMOTOCO", "HDFCLIFE", "DIVISLAB", "SBILIFE",
  "TECHM", "BAJAJ-AUTO", "ADANIPOWER", "SHRIRAMFIN", "INDUSINDBK", "APOLLOHOSP",
  "BPCL", "CONCOR", "GAIL", "IOC", "LICI", "NHPC", "OFSS", "PFC", "RECLTD",
  "RVNL", "SAIL", "TVSMOTOR", "ZOMATO", "PAYTM", "DELHIVERY", "LODHA",
];

const DEFAULT_TIMEFRAMES: Candle["tf"][] = ["1d", "1wk"];
const MAX_CONCURRENT = 4;

interface ProcessingStats {
  companiesSynced: number;
  symbolsProcessed: number;
  candlesWritten: number;
  fundamentalsSynced: number;
  errors: string[];
  startTime: number;
}

type ProcessorLogger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
};

function getLog(): ProcessorLogger {
  try {
    return getLogger().child({ worker: "daily-processor" });
  } catch {
    return {
      info: (...args: unknown[]) => console.log("[daily-processor]", ...args),
      warn: (...args: unknown[]) => console.warn("[daily-processor]", ...args),
      error: (...args: unknown[]) => console.error("[daily-processor]", ...args),
      debug: (...args: unknown[]) => console.debug("[daily-processor]", ...args),
    };
  }
}

export class DailyProcessor {
  private symbols: string[];
  private timeframes: Candle["tf"][];
  private backfillDays: number;
  private syncFundamentals: boolean;
  private dryRun: boolean;
  private running = false;

  constructor(opts: DailyProcessorOptions = {}) {
    this.symbols = opts.symbols ?? DEFAULT_SYMBOLS;
    this.timeframes = opts.timeframes ?? DEFAULT_TIMEFRAMES;
    this.backfillDays = opts.backfillDays ?? 365;
    this.syncFundamentals = opts.syncFundamentals ?? true;
    this.dryRun = opts.dryRun ?? false;
  }

  /** Run the full daily processing pipeline. Idempotent. */
  async run(): Promise<ProcessingStats> {
    if (this.running) {
      throw new Error("DailyProcessor.run() is already in progress");
    }
    this.running = true;
    const stats: ProcessingStats = {
      companiesSynced: 0,
      symbolsProcessed: 0,
      candlesWritten: 0,
      fundamentalsSynced: 0,
      errors: [],
      startTime: Date.now(),
    };
    const log = getLog();

    try {
      log.info({ symbols: this.symbols.length, timeframes: this.timeframes }, "starting daily processor");
      stats.companiesSynced = await this.syncCompanyMaster(log);
      await this.processSymbols(stats, log);
      if (this.syncFundamentals) {
        await this.processFundamentals(stats, log);
      }
      await this.cleanupStaleData(stats, log);
    } catch (err) {
      log.error({ err }, "daily processor fatal error");
      stats.errors.push(String(err));
    } finally {
      this.running = false;
      const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
      log.info({ elapsed, stats }, "daily processor finished");
    }

    return stats;
  }

  private async syncCompanyMaster(log: ProcessorLogger): Promise<number> {
    const master = await getNseCompanyMaster(true);
    if (this.dryRun) {
      log.info({ count: master.length }, "company master dry run complete");
      return master.length;
    }

    const updatedAt = new Date();
    for (let index = 0; index < master.length; index += 200) {
      const rows = master.slice(index, index + 200).map((company) => ({
        id: company.symbol,
        symbol: company.symbol,
        name: company.name,
        exchange: company.exchange,
        series: company.series,
        isin: company.isin || null,
        listingDate: company.listingDate ? new Date(`${company.listingDate}T00:00:00Z`) : null,
        marketLot: company.marketLot,
        faceValue: company.faceValue?.toString(),
        isActive: true,
        dataSource: company.source,
        lastMasterUpdate: updatedAt,
        updatedAt,
      }));
      await db.insert(companies).values(rows).onConflictDoUpdate({
        target: companies.symbol,
        set: {
          name: sql`excluded.name`,
          exchange: sql`excluded.exchange`,
          series: sql`excluded.series`,
          isin: sql`excluded.isin`,
          listingDate: sql`excluded.listing_date`,
          marketLot: sql`excluded.market_lot`,
          faceValue: sql`excluded.face_value`,
          isActive: true,
          dataSource: sql`excluded.data_source`,
          lastMasterUpdate: updatedAt,
          updatedAt,
        },
      });
    }
    log.info({ count: master.length }, "official NSE company master synced");
    return master.length;
  }

  // -------------------------------------------------------------------------
  // Symbol processing
  // -------------------------------------------------------------------------

  private async processSymbols(stats: ProcessingStats, log: ProcessorLogger): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - this.backfillDays * 24 * 60 * 60 * 1000);

    for (let i = 0; i < this.symbols.length; i += MAX_CONCURRENT) {
      const batch = this.symbols.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.allSettled(
        batch.map((sym) => this.processSymbol(sym, from, to, log))
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          stats.symbolsProcessed++;
          stats.candlesWritten += r.value.candlesWritten;
        } else {
          stats.errors.push(r.reason?.message ?? String(r.reason));
        }
      }
    }
  }

  private async processSymbol(
    symbol: string,
    from: Date,
    to: Date,
    log: ProcessorLogger
  ): Promise<{ candlesWritten: number }> {
    const resolved = resolveMarketSymbol(symbol);
    let candlesWritten = 0;

    for (const tf of this.timeframes) {
      try {
        const data = await getCandles(resolved.ticker, from, to, tf);
        if (data.length === 0) continue;

        const rows = data.map((c) => ({
          symbol: resolved.symbol,
          timeframe: tf,
          ts: new Date(c.ts),
          open: c.open.toString(),
          high: c.high.toString(),
          low: c.low.toString(),
          close: c.close.toString(),
          volume: Math.floor(c.volume),
          source: "yahoo",
        }));

        if (!this.dryRun) {
          await this.upsertCandles(rows);
        }
        candlesWritten += rows.length;
        log.debug({ symbol, tf, count: rows.length }, "candles written");
      } catch (err) {
        log.warn({ symbol, tf, err: String(err) }, "failed to fetch candles");
        throw err;
      }
    }

    return { candlesWritten };
  }

  private async upsertCandles(rows: Array<{
    symbol: string;
    timeframe: string;
    ts: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: number;
    source: string;
  }>): Promise<void> {
    for (const row of rows) {
      await db
        .insert(candles)
        .values(row)
        .onConflictDoUpdate({
          target: [candles.symbol, candles.timeframe, candles.ts],
          set: {
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,
            source: row.source,
          },
        });
    }
  }

  // -------------------------------------------------------------------------
  // Fundamentals sync
  // -------------------------------------------------------------------------

  private async processFundamentals(
    stats: ProcessingStats,
    log: ProcessorLogger
  ): Promise<void> {
    for (let i = 0; i < this.symbols.length; i += MAX_CONCURRENT) {
      const batch = this.symbols.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.allSettled(
        batch.map((sym) => this.syncSymbolFundamentals(sym, log))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) stats.fundamentalsSynced++;
        else if (r.status === "rejected") stats.errors.push(r.reason?.message ?? "fundamental sync failed");
      }
    }
  }

  private async syncSymbolFundamentals(
    symbol: string,
    log: ProcessorLogger
  ): Promise<boolean> {
    try {
      const data = await fetchNSEFundamentals(symbol);
      const now = new Date();
      const companyId = symbol.toUpperCase();

      // Upsert company
      await db
        .insert(companies)
        .values({
          id: companyId,
          symbol: companyId,
          name: data.symbol,
          exchange: "NSE",
          sector: data.sector,
          industry: data.raw?.industry,
          marketCap: data.marketCap?.toString(),
          peRatio: data.pe?.toString(),
          pbRatio: data.pb?.toString(),
          roe: data.roe?.toString(),
          dividendYield: data.dividendYield?.toString(),
          lastFundamentalsUpdate: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: companies.symbol,
          set: {
            sector: data.sector,
            industry: data.raw?.industry,
            marketCap: data.marketCap?.toString(),
            peRatio: data.pe?.toString(),
            pbRatio: data.pb?.toString(),
            roe: data.roe?.toString(),
            dividendYield: data.dividendYield?.toString(),
            lastFundamentalsUpdate: now,
            updatedAt: now,
          },
        });

      // Upsert latest fundamentals snapshot
      const fundId = `${companyId}-${now.toISOString().slice(0, 7)}`;
      await db
        .insert(fundamentals)
        .values({
          id: fundId,
          companyId,
          periodDate: now,
          periodType: "quarterly",
          peRatio: data.pe?.toString(),
          pbRatio: data.pb?.toString(),
          roe: data.roe?.toString(),
          marketCap: data.marketCap?.toString(),
          dividendYield: data.dividendYield?.toString(),
          source: "nse",
          raw: data.raw as any,
        })
        .onConflictDoNothing();

      log.debug({ symbol, pe: data.pe, pb: data.pb }, "fundamentals synced");
      return true;
    } catch (err) {
      log.warn({ symbol, err: String(err) }, "failed to sync fundamentals");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  private async cleanupStaleData(
    stats: ProcessingStats,
    log: ProcessorLogger
  ): Promise<void> {
    if (this.dryRun) {
      log.info("skipping cleanup in dry-run mode");
      return;
    }

    // Delete candles older than 5 years (keep 5y of history)
    const cutoff = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
    try {
      await db
        .delete(candles)
        .where(sql`${candles.ts} < ${cutoff}`);

      log.info({ cutoff }, "stale candle data cleaned up");
    } catch (err) {
      log.warn({ err }, "failed to cleanup stale candles");
    }
  }
}

/** Convenience: run the processor once. */
export async function runDailyProcessor(opts?: DailyProcessorOptions): Promise<ProcessingStats> {
  const processor = new DailyProcessor(opts);
  return processor.run();
}
