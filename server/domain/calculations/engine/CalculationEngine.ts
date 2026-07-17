/**
 * Calculation Engine — Master Orchestrator
 * Coordinates loading data, running calculators, and storing results
 */

import { getLogger } from "../../../infra/logger";
import { db } from "../../../data/drizzle/client";
import { sql } from "drizzle-orm";
import {
  getAllCalculators,
  getCalculatorsByFrequency,
  getCalculatorsByCategory,
  getRegistryStats,
  type CalculatorInput,
} from "./calculator-registry";
import { runBatch, runSingle } from "./batch-runner";
import { writeResults } from "./result-writer";

const logger = getLogger("calculation-engine");

export interface EngineRunOptions {
  symbols?: string[];
  frequency?: "daily" | "weekly" | "quarterly" | "on-demand";
  categories?: string[];
  dryRun?: boolean;
  concurrency?: number;
  date?: string; // YYYY-MM-DD, defaults to today
}

export interface EngineRunResult {
  symbolsProcessed: number;
  calculationsRun: number;
  resultsWritten: number;
  durationMs: number;
  errors: number;
}

/**
 * Load OHLCV data for a symbol from the Supabase candles table.
 */
async function loadPriceData(symbol: string): Promise<{
  closes: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  dates: string[];
}> {
  const rows = await db.execute(sql`
    SELECT ts, open, high, low, close, volume
    FROM candles
    WHERE symbol = ${symbol} AND timeframe = '1d'
    ORDER BY ts ASC
    LIMIT 500
  `);

  const data = rows as any[];
  return {
    closes: data.map((r) => parseFloat(r.close)),
    opens: data.map((r) => parseFloat(r.open)),
    highs: data.map((r) => parseFloat(r.high)),
    lows: data.map((r) => parseFloat(r.low)),
    volumes: data.map((r) => parseInt(r.volume)),
    dates: data.map((r) => new Date(r.ts).toISOString().split("T")[0]),
  };
}

/**
 * Load fundamental data for a symbol from the Supabase fundamentals table.
 */
async function loadFundamentalData(symbol: string): Promise<Record<string, number | null>> {
  const rows = await db.execute(sql`
    SELECT
      f.pe_ratio, f.pb_ratio, f.roe, f.market_cap, f.dividend_yield, f.eps,
      f.debt_to_equity, f.current_ratio, f.quick_ratio, f.interest_coverage,
      f.asset_turnover, f.free_cash_flow, f.free_cash_flow_margin,
      f.gross_margin, f.operating_margin, f.ebitda_margin, f.net_margin,
      f.revenue_growth, f.net_income_growth,
      f.return_on_assets, f.return_on_invested_capital, f.roce,
      f.earnings_yield, f.free_cash_flow_yield, f.enterprise_value_to_ebitda,
      fs.revenue, fs.net_income, fs.total_assets, fs.total_liabilities,
      fs.shareholders_equity, fs.current_assets, fs.current_liabilities,
      fs.total_debt, fs.cash_and_equivalents, fs.inventory,
      fs.operating_cash_flow, fs.capital_expenditure, fs.ebitda, fs.ebit,
      fs.interest_expense, fs.shares_outstanding, fs.operating_income,
      fs.cost_of_revenue
    FROM fundamentals f
    LEFT JOIN financial_statements fs ON fs.company_id = f.company_id
      AND fs.period_type = 'annual'
    WHERE f.company_id = ${symbol}
    ORDER BY f.period_date DESC, fs.period_date DESC
    LIMIT 1
  `);

  if (!rows || (rows as any[]).length === 0) return {};

  const r = (rows as any[])[0];
  return {
    peRatio: r.pe_ratio ? parseFloat(r.pe_ratio) : null,
    pbRatio: r.pb_ratio ? parseFloat(r.pb_ratio) : null,
    roe: r.roe ? parseFloat(r.roe) : null,
    marketCap: r.market_cap ? parseFloat(r.market_cap) : null,
    dividendYield: r.dividend_yield ? parseFloat(r.dividend_yield) : null,
    debtToEquity: r.debt_to_equity ? parseFloat(r.debt_to_equity) : null,
    currentRatio: r.current_ratio ? parseFloat(r.current_ratio) : null,
    revenue: r.revenue ? parseFloat(r.revenue) : null,
    netIncome: r.net_income ? parseFloat(r.net_income) : null,
    totalAssets: r.total_assets ? parseFloat(r.total_assets) : null,
    shareholdersEquity: r.shareholders_equity ? parseFloat(r.shareholders_equity) : null,
    currentAssets: r.current_assets ? parseFloat(r.current_assets) : null,
    currentLiabilities: r.current_liabilities ? parseFloat(r.current_liabilities) : null,
    totalDebt: r.total_debt ? parseFloat(r.total_debt) : null,
    cashAndEquivalents: r.cash_and_equivalents ? parseFloat(r.cash_and_equivalents) : null,
    inventory: r.inventory ? parseFloat(r.inventory) : null,
    operatingCashFlow: r.operating_cash_flow ? parseFloat(r.operating_cash_flow) : null,
    capitalExpenditure: r.capital_expenditure ? parseFloat(r.capital_expenditure) : null,
    ebitda: r.ebitda ? parseFloat(r.ebitda) : null,
    ebit: r.ebit ? parseFloat(r.ebit) : null,
    interestExpense: r.interest_expense ? parseFloat(r.interest_expense) : null,
    sharesOutstanding: r.shares_outstanding ? parseFloat(r.shares_outstanding) : null,
    operatingIncome: r.operating_income ? parseFloat(r.operating_income) : null,
    costOfRevenue: r.cost_of_revenue ? parseFloat(r.cost_of_revenue) : null,
  };
}

/**
 * Build a CalculatorInput for a given symbol.
 */
async function buildInput(symbol: string): Promise<CalculatorInput> {
  const [price, fundamentals] = await Promise.all([
    loadPriceData(symbol),
    loadFundamentalData(symbol),
  ]);

  return {
    symbol,
    closes: price.closes,
    opens: price.opens,
    highs: price.highs,
    lows: price.lows,
    volumes: price.volumes,
    dates: price.dates,
    financials: fundamentals,
    marketData: {
      price: price.closes[price.closes.length - 1] ?? null,
      marketCap: fundamentals.marketCap ?? null,
    },
    period: new Date().toISOString().split("T")[0],
  };
}

/**
 * Load all active symbols from the companies table.
 */
async function loadActiveSymbols(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT symbol FROM companies
    WHERE exchange = 'NSE' AND is_active = true
    ORDER BY symbol ASC
  `);
  return (rows as any[]).map((r) => r.symbol);
}

/**
 * Run the calculation engine for all or specified symbols.
 */
export async function runCalculationEngine(opts: EngineRunOptions = {}): Promise<EngineRunResult> {
  const startTime = Date.now();
  const date = opts.date ?? new Date().toISOString().split("T")[0];

  logger.info({ opts, registryStats: getRegistryStats() }, "Calculation engine starting");

  // Determine which calculators to run
  const calculators = opts.frequency
    ? getCalculatorsByFrequency(opts.frequency)
    : getAllCalculators();

  if (calculators.length === 0) {
    logger.warn("No calculators found for specified criteria");
    return { symbolsProcessed: 0, calculationsRun: 0, resultsWritten: 0, durationMs: 0, errors: 0 };
  }

  // Determine which symbols to process
  const symbols = opts.symbols?.length
    ? opts.symbols
    : await loadActiveSymbols();

  logger.info({ symbols: symbols.length, calculators: calculators.length }, "Running calculations");

  // Run batch
  const { results, summary } = await runBatch(
    symbols,
    calculators,
    buildInput,
    {
      concurrency: opts.concurrency ?? 50,
      timeoutMs: 30_000,
      onProgress: (completed, total) => {
        if (completed % 500 === 0) {
          logger.info({ completed, total, pct: Math.round((completed / total) * 100) }, "Engine progress");
        }
      },
    }
  );

  // Write results
  if (!opts.dryRun) {
    await writeResults(results, date);
  }

  const totalDurationMs = Date.now() - startTime;
  logger.info({ ...summary, durationMs: totalDurationMs }, "Calculation engine complete");

  return {
    symbolsProcessed: summary.totalSymbols,
    calculationsRun: summary.totalOutputs,
    resultsWritten: opts.dryRun ? 0 : summary.totalOutputs,
    durationMs: totalDurationMs,
    errors: summary.failed,
  };
}

/**
 * On-demand single-symbol calculation (for API cache miss scenarios).
 */
export async function runOnDemand(symbol: string, indicatorNames?: string[]): Promise<Record<string, number | null>> {
  const calculators = indicatorNames
    ? indicatorNames.map((n) => {
        const { getCalculator } = require("./calculator-registry");
        return getCalculator(n);
      }).filter(Boolean)
    : getAllCalculators();

  const input = await buildInput(symbol);
  const outputs = await runSingle(symbol, calculators, input);

  const result: Record<string, number | null> = {};
  for (const o of outputs) {
    result[o.indicatorName] = o.value;
    if (o.signal !== undefined) result[`${o.indicatorName}_SIGNAL`] = o.signal;
    if (o.hist !== undefined) result[`${o.indicatorName}_HIST`] = o.hist;
  }
  return result;
}
