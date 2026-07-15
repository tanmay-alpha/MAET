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
import {
  candles,
  companies,
  companyIdentifiers,
  financialStatements,
  fundamentals,
  marketCapClassifications,
  quoteSnapshots,
} from "../db/schema";
import { getCandles } from "../data/sources/yahoo";
import { getFundamentals as fetchNSEFundamentals } from "../data/sources/nse";
import { getNseCompanyMaster } from "../data/sources/nse-company-master";
import { getYahooFundamentals } from "../data/sources/yahoo-fundamentals";
import { resolveMarketSymbol } from "../domain/market/symbol";
import { loadQuote } from "../domain/market/quote-service";
import { classifyByMarketCapRank } from "../domain/fundamentals/classification";
import { calculateFundamentalRatios } from "../domain/fundamentals/ratios";
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
  /** Whether to refresh the NSE company master. Default: true. */
  syncCompanyMaster?: boolean;
  /** Whether to fetch candles and quote snapshots. Default: true. */
  syncMarketData?: boolean;
  /** Whether to refresh market-cap buckets after ingestion. Default: true. */
  refreshClassifications?: boolean;
  /** Whether to remove candles older than the retention window. Default: true. */
  cleanupStaleData?: boolean;
  /** Dry run: log actions without writing to DB. Default: false. */
  dryRun?: boolean;
};

// Default symbols include Nifty 50 plus additional large/mid-cap stocks for
// broader quote and fundamentals coverage on every daily run.
const DEFAULT_SYMBOLS = [
  // Nifty 50 core
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC", "KOTAKBANK",
  "LT", "SBIN", "AXISBANK", "ASIANPAINT", "MARUTI", "BAJFINANCE", "TITAN", "NESTLEIND",
  "M&M", "SUNPHARMA", "ULTRACEMCO", "TATASTEEL", "WIPRO", "ADANIPORTS", "POWERGRID",
  "NTPC", "ONGC", "COALINDIA", "JSWSTEEL", "ADANIENT", "BRITANNIA", "CIPLA", "DRREDDY",
  "EICHERMOT", "GRASIM", "HCLTECH", "HEROMOTOCO", "HDFCLIFE", "DIVISLAB", "SBILIFE",
  "TECHM", "BAJAJ-AUTO", "ADANIPOWER", "SHRIRAMFIN", "INDUSINDBK", "APOLLOHOSP",
  "BPCL", "CONCOR", "GAIL", "IOC", "LICI", "NHPC", "OFSS", "PFC", "RECLTD",
  "RVNL", "SAIL", "TVSMOTOR", "ZOMATO", "PAYTM", "DELHIVERY", "LODHA",
  // Additional large-cap IT
  "LTIM", "MPHASIS", "PERSISTENT", "COFORGE", "KPITTECH",
  // Banking & NBFC
  "BANDHANBNK", "FEDERALBNK", "IDFCFIRSTB", "BANKBARODA", "PNB", "CANBK",
  "BAJAJFINSV", "CHOLAFIN", "MUTHOOTFIN", "MANAPPURAM",
  // Auto & ancillaries
  "TATAMOTORS", "BAJAJ-AUTO", "TVSMOTOR", "MOTHERSON", "BALKRISIND", "MRF",
  // Energy & utilities
  "TATAPOWER", "TORNTPOWER", "CESC", "SJVN", "IREDA",
  // Pharma
  "AUROPHARMA", "LUPIN", "TORNTPHARM", "ALKEM", "IPCALAB",
  // Consumer
  "GODREJCP", "DABUR", "EMAMILTD", "MARICO", "COLPAL",
  // Metals & Mining
  "HINDALCO", "VEDL", "NMDC", "MOIL",
  // Infra & capital goods
  "SIEMENS", "ABB", "BHEL", "TIINDIA",
  // Telecom & media
  "BHARTIARTL", "IDEA",
  // Real estate
  "DLF", "GODREJPROP", "OBEROIRLTY",
  // Chemical
  "PIDILITIND", "SRF", "DEEPAKNTR",
  // Insurance
  "ICICIPRULI", "ICICIGI", "STARHEALTH",
];

const DEFAULT_TIMEFRAMES: Candle["tf"][] = ["1d", "1wk"];
const MAX_CONCURRENT = 4;

export interface ProcessingStats {
  companiesSynced: number;
  symbolsProcessed: number;
  candlesWritten: number;
  fundamentalsSynced: number;
  fundamentalsFailed: string[];
  quoteSnapshotsWritten: number;
  classificationsSynced: number;
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
  private syncCompanyMaster: boolean;
  private syncMarketData: boolean;
  private refreshClassifications: boolean;
  private cleanupEnabled: boolean;
  private dryRun: boolean;
  private running = false;

  constructor(opts: DailyProcessorOptions = {}) {
    this.symbols = opts.symbols ?? DEFAULT_SYMBOLS;
    this.timeframes = opts.timeframes ?? DEFAULT_TIMEFRAMES;
    this.backfillDays = opts.backfillDays ?? 365;
    this.syncFundamentals = opts.syncFundamentals ?? true;
    this.syncCompanyMaster = opts.syncCompanyMaster ?? true;
    this.syncMarketData = opts.syncMarketData ?? true;
    this.refreshClassifications = opts.refreshClassifications ?? true;
    this.cleanupEnabled = opts.cleanupStaleData ?? true;
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
      fundamentalsFailed: [],
      quoteSnapshotsWritten: 0,
      classificationsSynced: 0,
      errors: [],
      startTime: Date.now(),
    };
    const log = getLog();

    try {
      log.info({ symbols: this.symbols.length, timeframes: this.timeframes }, "starting daily processor");
      if (this.syncCompanyMaster) {
        stats.companiesSynced = await this.syncCompanyMasterEntries(log);
      }
      if (this.syncMarketData) {
        await this.processSymbols(stats, log);
      }
      if (this.syncFundamentals) {
        await this.processFundamentals(stats, log);
      }
      if (this.refreshClassifications) {
        stats.classificationsSynced = await this.refreshMarketCapClassifications(log);
      }
      if (this.cleanupEnabled) {
        await this.cleanupStaleData(stats, log);
      }
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

  private async syncCompanyMasterEntries(log: ProcessorLogger): Promise<number> {
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

      const identifiers = master.slice(index, index + 200).flatMap((company) => [
        {
          companyId: company.symbol,
          identifierType: "nse_symbol",
          identifierValue: company.symbol,
          source: "nse",
          verifiedAt: updatedAt,
        },
        ...(company.isin ? [{
          companyId: company.symbol,
          identifierType: "isin",
          identifierValue: company.isin,
          source: "nse",
          verifiedAt: updatedAt,
        }] : []),
        {
          companyId: company.symbol,
          identifierType: "yahoo_symbol",
          identifierValue: `${company.symbol}.NS`,
          source: "derived_from_nse_symbol",
          verifiedAt: updatedAt,
        },
      ]);
      await db.insert(companyIdentifiers).values(identifiers).onConflictDoUpdate({
        target: [companyIdentifiers.identifierType, companyIdentifiers.identifierValue],
        set: {
          companyId: sql`excluded.company_id`,
          source: sql`excluded.source`,
          verifiedAt: updatedAt,
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
          stats.quoteSnapshotsWritten += r.value.quoteSnapshotWritten ? 1 : 0;
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
  ): Promise<{ candlesWritten: number; quoteSnapshotWritten: boolean }> {
    const resolved = resolveMarketSymbol(symbol);
    let candlesWritten = 0;
    let dailyCandles: Candle[] = [];

    for (const tf of this.timeframes) {
      try {
        const data = await getCandles(resolved.ticker, from, to, tf);
        if (data.length === 0) continue;
        if (tf === "1d") dailyCandles = data;

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

    const quoteSnapshotWritten = await this.persistMarketSnapshot(resolved.symbol, dailyCandles, log);
    return { candlesWritten, quoteSnapshotWritten };
  }

  private async persistMarketSnapshot(symbol: string, dailyCandles: Candle[], log: ProcessorLogger): Promise<boolean> {
    try {
      const quote = await loadQuote(symbol, true);
      const asOf = new Date(quote.ts);
      if (!this.dryRun) {
        await db.insert(quoteSnapshots).values({
          companyId: symbol,
          price: quote.price.toString(),
          changePct: quote.changePct?.toString(),
          volume: quote.volume,
          asOf,
          source: quote.source,
        }).onConflictDoNothing();

        const validDaily = dailyCandles.filter((candle) => Number.isFinite(candle.close) && Number.isFinite(candle.volume));
        const trailingYear = validDaily.slice(-252);
        const last20 = validDaily.slice(-20);
        const average20DayVolume = last20.length === 20
          ? Math.round(last20.reduce((sum, candle) => sum + candle.volume, 0) / last20.length)
          : undefined;
        const fiftyTwoWeekHigh = trailingYear.length > 0 ? Math.max(...trailingYear.map((candle) => candle.high)) : undefined;
        const fiftyTwoWeekLow = trailingYear.length > 0 ? Math.min(...trailingYear.map((candle) => candle.low)) : undefined;
        const relativeVolume = average20DayVolume && average20DayVolume > 0 ? quote.volume / average20DayVolume : undefined;
        const [company] = await db.select().from(companies).where(sql`${companies.id} = ${symbol}`).limit(1);
        const snapshotId = `${symbol}-market-${asOf.toISOString().slice(0, 10)}`;
        await db.insert(fundamentals).values({
          id: snapshotId,
          companyId: symbol,
          periodDate: asOf,
          periodType: "market",
          marketCap: company?.marketCap,
          peRatio: company?.peRatio,
          pbRatio: company?.pbRatio,
          roe: company?.roe,
          dividendYield: company?.dividendYield,
          eps: company?.eps,
          debtToEquity: company?.debtToEquity,
          fiftyTwoWeekHigh: fiftyTwoWeekHigh?.toString(),
          fiftyTwoWeekLow: fiftyTwoWeekLow?.toString(),
          average20DayVolume,
          relativeVolume: relativeVolume?.toString(),
          source: `${company?.dataSource ?? "nse"}+${quote.source}+yahoo_candles`,
          sourceFlags: {
            quote: quote.source,
            candles: "yahoo",
            fundamentals: company?.dataSource ?? "unavailable",
          },
          isStale: false,
        }).onConflictDoUpdate({
          target: fundamentals.id,
          set: {
            periodDate: asOf,
            fiftyTwoWeekHigh: fiftyTwoWeekHigh?.toString(),
            fiftyTwoWeekLow: fiftyTwoWeekLow?.toString(),
            average20DayVolume,
            relativeVolume: relativeVolume?.toString(),
            source: `${company?.dataSource ?? "nse"}+${quote.source}+yahoo_candles`,
            sourceFlags: {
              quote: quote.source,
              candles: "yahoo",
              fundamentals: company?.dataSource ?? "unavailable",
            },
            isStale: false,
          },
        });
      }
      return true;
    } catch (error) {
      log.warn({ symbol, err: String(error) }, "failed to persist quote/market metrics snapshot");
      return false;
    }
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
      for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
        const result = results[resultIndex];
        const symbol = batch[resultIndex];
        if (result.status === "fulfilled" && result.value) {
          stats.fundamentalsSynced++;
        } else {
          stats.fundamentalsFailed.push(symbol);
          if (result.status === "rejected") {
            stats.errors.push(result.reason?.message ?? `fundamental sync failed for ${symbol}`);
          }
        }
      }
    }
  }

  private async syncSymbolFundamentals(
    symbol: string,
    log: ProcessorLogger
  ): Promise<boolean> {
    try {
      const yahoo = await getYahooFundamentals(symbol);
      if (yahoo) {
        const now = new Date(yahoo.asOf);
        const companyId = symbol.toUpperCase();
        const quote = await loadQuote(companyId).catch(() => undefined);
        const statements = yahoo.statements.sort((left, right) => right.periodDate.localeCompare(left.periodDate));
        const current = statements[0];
        const previous = statements.find((statement) => statement.periodType === current?.periodType && statement.periodDate !== current.periodDate);
        const calculated = current ? calculateFundamentalRatios(current, previous, {
          price: quote?.price,
          marketCap: yahoo.marketCap,
        }) : {};

        await db.insert(companies).values({
          id: companyId,
          symbol: companyId,
          name: companyId,
          exchange: "NSE",
          yahooSymbol: `${companyId}.NS`,
          marketCap: yahoo.marketCap?.toString(),
          peRatio: yahoo.trailingPe?.toString(),
          pbRatio: yahoo.pb?.toString(),
          roe: yahoo.roe?.toString(),
          dividendYield: yahoo.dividendYield?.toString(),
          eps: yahoo.epsTtm?.toString(),
          debtToEquity: yahoo.debtToEquity?.toString(),
          // Write sector/industry from Yahoo assetProfile when available.
          ...(yahoo.sector ? { sector: yahoo.sector } : {}),
          ...(yahoo.industry ? { industry: yahoo.industry } : {}),
          lastFundamentalsUpdate: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: companies.symbol,
          set: {
            yahooSymbol: `${companyId}.NS`,
            marketCap: yahoo.marketCap?.toString(),
            peRatio: yahoo.trailingPe?.toString(),
            pbRatio: yahoo.pb?.toString(),
            roe: yahoo.roe?.toString(),
            dividendYield: yahoo.dividendYield?.toString(),
            eps: yahoo.epsTtm?.toString(),
            debtToEquity: yahoo.debtToEquity?.toString(),
            // Only overwrite sector/industry if Yahoo returned a non-null value.
            ...(yahoo.sector ? { sector: yahoo.sector } : {}),
            ...(yahoo.industry ? { industry: yahoo.industry } : {}),
            lastFundamentalsUpdate: now,
            updatedAt: now,
          },
        });

        for (const statement of statements) {
          const statementId = `${companyId}-${statement.periodType}-${statement.periodDate.slice(0, 10)}`;
          await db.insert(financialStatements).values({
            id: statementId,
            companyId,
            periodDate: new Date(statement.periodDate),
            periodType: statement.periodType,
            statementType: "combined",
            fiscalYear: statement.fiscalYear,
            currency: statement.currency,
            revenue: statement.revenue?.toString(),
            costOfRevenue: statement.costOfRevenue?.toString(),
            operatingIncome: statement.operatingIncome?.toString(),
            ebitda: statement.ebitda?.toString(),
            ebit: statement.ebit?.toString(),
            interestExpense: statement.interestExpense?.toString(),
            taxExpense: statement.taxExpense?.toString(),
            netIncome: statement.netIncome?.toString(),
            totalAssets: statement.totalAssets?.toString(),
            currentAssets: statement.currentAssets?.toString(),
            inventory: statement.inventory?.toString(),
            cashAndEquivalents: statement.cashAndEquivalents?.toString(),
            totalLiabilities: statement.totalLiabilities?.toString(),
            currentLiabilities: statement.currentLiabilities?.toString(),
            totalDebt: statement.totalDebt?.toString(),
            shareholdersEquity: statement.shareholdersEquity?.toString(),
            operatingCashFlow: statement.operatingCashFlow?.toString(),
            capitalExpenditure: statement.capitalExpenditure?.toString(),
            dividendsPaid: statement.dividendsPaid?.toString(),
            sharesOutstanding: statement.sharesOutstanding?.toString(),
            source: "yahoo",
            sourceUrl: `https://finance.yahoo.com/quote/${companyId}.NS/financials`,
            raw: statement.raw,
            asOf: now,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: financialStatements.id,
            set: {
              revenue: statement.revenue?.toString(),
              costOfRevenue: statement.costOfRevenue?.toString(),
              operatingIncome: statement.operatingIncome?.toString(),
              ebitda: statement.ebitda?.toString(),
              ebit: statement.ebit?.toString(),
              interestExpense: statement.interestExpense?.toString(),
              taxExpense: statement.taxExpense?.toString(),
              netIncome: statement.netIncome?.toString(),
              totalAssets: statement.totalAssets?.toString(),
              currentAssets: statement.currentAssets?.toString(),
              inventory: statement.inventory?.toString(),
              cashAndEquivalents: statement.cashAndEquivalents?.toString(),
              totalLiabilities: statement.totalLiabilities?.toString(),
              currentLiabilities: statement.currentLiabilities?.toString(),
              totalDebt: statement.totalDebt?.toString(),
              shareholdersEquity: statement.shareholdersEquity?.toString(),
              operatingCashFlow: statement.operatingCashFlow?.toString(),
              capitalExpenditure: statement.capitalExpenditure?.toString(),
              dividendsPaid: statement.dividendsPaid?.toString(),
              sharesOutstanding: statement.sharesOutstanding?.toString(),
              raw: statement.raw,
              asOf: now,
              updatedAt: now,
            },
          });
        }

        const fundId = `${companyId}-fundamentals-${now.toISOString().slice(0, 10)}`;
        await db.insert(fundamentals).values({
          id: fundId,
          companyId,
          periodDate: now,
          periodType: "snapshot",
          marketCap: yahoo.marketCap?.toString(),
          peRatio: (yahoo.trailingPe ?? calculated.peRatio)?.toString(),
          forwardPe: yahoo.forwardPe?.toString(),
          pbRatio: (yahoo.pb ?? calculated.pbRatio)?.toString(),
          roe: (yahoo.roe ?? calculated.roe)?.toString(),
          roce: calculated.roce?.toString(),
          returnOnAssets: calculated.returnOnAssets?.toString(),
          dividendYield: yahoo.dividendYield?.toString(),
          eps: (yahoo.epsTtm ?? calculated.eps)?.toString(),
          bookValuePerShare: yahoo.bookValuePerShare?.toString(),
          debtToEquity: (yahoo.debtToEquity ?? calculated.debtToEquity)?.toString(),
          currentRatio: (yahoo.currentRatio ?? calculated.currentRatio)?.toString(),
          operatingMargin: calculated.operatingMargin?.toString(),
          netMargin: calculated.netMargin?.toString(),
          revenueGrowth: calculated.revenueGrowth?.toString(),
          netIncomeGrowth: calculated.netIncomeGrowth?.toString(),
          fiftyTwoWeekHigh: yahoo.fiftyTwoWeekHigh?.toString(),
          fiftyTwoWeekLow: yahoo.fiftyTwoWeekLow?.toString(),
          revenue: current?.revenue?.toString(),
          netIncome: current?.netIncome?.toString(),
          source: "yahoo",
          sourceFlags: { provider: yahoo.source, normalizedStatements: statements.length > 0 },
          isStale: false,
          raw: yahoo.raw,
        }).onConflictDoUpdate({
          target: fundamentals.id,
          set: {
            marketCap: yahoo.marketCap?.toString(), peRatio: (yahoo.trailingPe ?? calculated.peRatio)?.toString(), forwardPe: yahoo.forwardPe?.toString(),
            pbRatio: (yahoo.pb ?? calculated.pbRatio)?.toString(), roe: (yahoo.roe ?? calculated.roe)?.toString(),
            roce: calculated.roce?.toString(), returnOnAssets: calculated.returnOnAssets?.toString(),
            dividendYield: yahoo.dividendYield?.toString(), eps: (yahoo.epsTtm ?? calculated.eps)?.toString(),
            bookValuePerShare: yahoo.bookValuePerShare?.toString(),
            debtToEquity: (yahoo.debtToEquity ?? calculated.debtToEquity)?.toString(),
            currentRatio: (yahoo.currentRatio ?? calculated.currentRatio)?.toString(),
            operatingMargin: calculated.operatingMargin?.toString(), netMargin: calculated.netMargin?.toString(),
            revenueGrowth: calculated.revenueGrowth?.toString(), netIncomeGrowth: calculated.netIncomeGrowth?.toString(),
            fiftyTwoWeekHigh: yahoo.fiftyTwoWeekHigh?.toString(), fiftyTwoWeekLow: yahoo.fiftyTwoWeekLow?.toString(),
            revenue: current?.revenue?.toString(), netIncome: current?.netIncome?.toString(),
            raw: yahoo.raw, sourceFlags: { provider: yahoo.source, normalizedStatements: statements.length > 0 }, isStale: false,
          },
        });
        log.debug({ symbol, statements: statements.length, pe: yahoo.trailingPe }, "Yahoo fundamentals synced");
        return true;
      }

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

  private async refreshMarketCapClassifications(log: ProcessorLogger): Promise<number> {
    if (this.dryRun) return 0;
    const rows = await db.select({ companyId: companies.id, marketCap: companies.marketCap }).from(companies);
    const rankedCoverage = rows.filter((row) => row.marketCap !== null && Number(row.marketCap) > 0).length;
    if (rankedCoverage < 250) {
      log.warn({ rankedCoverage, universe: rows.length }, "market-cap classification skipped: fewer than 250 verified market caps");
      return 0;
    }
    const classifications = classifyByMarketCapRank(rows.map((row) => ({
      companyId: row.companyId,
      marketCap: row.marketCap ? Number(row.marketCap) : undefined,
    }))).filter((classification) => classification.bucket !== "unknown");
    const effectiveFrom = new Date();
    const classificationVersion = effectiveFrom.toISOString().slice(0, 10);
    await db.update(marketCapClassifications).set({
      effectiveTo: effectiveFrom,
    }).where(sql`
      ${marketCapClassifications.effectiveTo} is null
      and ${marketCapClassifications.classificationVersion} <> ${classificationVersion}
    `);
    await db.update(companies).set({
      marketCapBucket: "unknown",
      updatedAt: effectiveFrom,
    }).where(sql`${companies.marketCap} is null or ${companies.marketCap} <= 0`);
    await db.delete(marketCapClassifications).where(sql`
      ${marketCapClassifications.classificationVersion} = ${classificationVersion}
      and ${marketCapClassifications.bucket} = 'unknown'
    `);
    for (let index = 0; index < classifications.length; index += 50) {
      const batch = classifications.slice(index, index + 50);
      await Promise.all(batch.map(async (classification) => {
        await db.update(companies).set({
          marketCapBucket: classification.bucket,
          updatedAt: effectiveFrom,
        }).where(sql`${companies.id} = ${classification.companyId}`);
        await db.insert(marketCapClassifications).values({
          companyId: classification.companyId,
          classificationVersion,
          bucket: classification.bucket,
          methodology: classification.methodology,
          effectiveFrom,
          source: "derived_stored_market_cap_rank",
        }).onConflictDoUpdate({
          target: [marketCapClassifications.companyId, marketCapClassifications.classificationVersion],
          set: {
            bucket: classification.bucket,
            methodology: classification.methodology,
            effectiveFrom,
            effectiveTo: null,
            source: "derived_stored_market_cap_rank",
          },
        });
      }));
    }
    log.info({ count: classifications.length, classificationVersion }, "market-cap classifications refreshed");
    return classifications.length;
  }
}

/** Convenience: run the processor once. */
export async function runDailyProcessor(opts?: DailyProcessorOptions): Promise<ProcessingStats> {
  const processor = new DailyProcessor(opts);
  return processor.run();
}
