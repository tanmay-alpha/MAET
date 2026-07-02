import { getCachedJson, setCachedJson } from "../redis/client";
import { RedisKeys } from "../redis/keys";

type YahooValue = { raw?: number } | number | null | undefined;
interface YahooRecord {
  [key: string]: YahooValue | YahooRecord | YahooRecord[] | undefined;
}

export type YahooStatement = {
  periodDate: string;
  periodType: "annual" | "quarterly";
  fiscalYear: number;
  currency: string;
  revenue?: number;
  costOfRevenue?: number;
  operatingIncome?: number;
  ebitda?: number;
  ebit?: number;
  interestExpense?: number;
  taxExpense?: number;
  netIncome?: number;
  totalAssets?: number;
  currentAssets?: number;
  inventory?: number;
  cashAndEquivalents?: number;
  totalLiabilities?: number;
  currentLiabilities?: number;
  totalDebt?: number;
  shareholdersEquity?: number;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  dividendsPaid?: number;
  sharesOutstanding?: number;
  raw: Record<string, unknown>;
};

export type YahooFundamentals = {
  symbol: string;
  asOf: string;
  marketCap?: number;
  trailingPe?: number;
  forwardPe?: number;
  pb?: number;
  epsTtm?: number;
  bookValuePerShare?: number;
  dividendYield?: number;
  roe?: number;
  debtToEquity?: number;
  currentRatio?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  statements: YahooStatement[];
  raw: Record<string, unknown>;
};

const MODULES = [
  "summaryDetail", "defaultKeyStatistics", "financialData",
  "incomeStatementHistory", "incomeStatementHistoryQuarterly",
  "balanceSheetHistory", "balanceSheetHistoryQuarterly",
  "cashflowStatementHistory", "cashflowStatementHistoryQuarterly",
].join(",");

function raw(value: YahooValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value && typeof value === "object" && "raw" in value && typeof value.raw === "number" && Number.isFinite(value.raw)) return value.raw;
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(module: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = module[key];
  return Array.isArray(value) ? value.map(record) : [];
}

function dateFrom(row: Record<string, unknown>): string | undefined {
  const seconds = raw(row.endDate as YahooValue);
  return seconds ? new Date(seconds * 1_000).toISOString() : undefined;
}

function field(row: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = raw(row[name] as YahooValue);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function parseYahooFundamentals(symbol: string, payload: unknown): YahooFundamentals | null {
  const root = record(payload);
  const quoteSummary = record(root.quoteSummary);
  const results = Array.isArray(quoteSummary.result) ? quoteSummary.result : [];
  const result = record(results[0]);
  if (Object.keys(result).length === 0) return null;
  const summary = record(result.summaryDetail);
  const stats = record(result.defaultKeyStatistics);
  const financial = record(result.financialData);

  const merged = new Map<string, YahooStatement>();
  const mergeRows = (values: Record<string, unknown>[], periodType: YahooStatement["periodType"], kind: string) => {
    for (const row of values) {
      const periodDate = dateFrom(row);
      if (!periodDate) continue;
      const key = `${periodType}:${periodDate.slice(0, 10)}`;
      const current = merged.get(key) ?? {
        periodDate, periodType, fiscalYear: new Date(periodDate).getUTCFullYear(), currency: "INR", raw: {},
      };
      if (kind === "income") Object.assign(current, {
        revenue: field(row, "totalRevenue"), costOfRevenue: field(row, "costOfRevenue"),
        operatingIncome: field(row, "operatingIncome"), ebitda: field(row, "ebitda", "normalizedEBITDA"),
        ebit: field(row, "ebit"), interestExpense: field(row, "interestExpense"),
        taxExpense: field(row, "incomeTaxExpense"), netIncome: field(row, "netIncome"),
      });
      if (kind === "balance") Object.assign(current, {
        totalAssets: field(row, "totalAssets"), currentAssets: field(row, "totalCurrentAssets", "currentAssets"),
        inventory: field(row, "inventory"), cashAndEquivalents: field(row, "cash", "cashCashEquivalentsAndShortTermInvestments"),
        totalLiabilities: field(row, "totalLiab", "totalLiabilitiesNetMinorityInterest"),
        currentLiabilities: field(row, "totalCurrentLiabilities", "currentLiabilities"),
        totalDebt: field(row, "totalDebt", "longTermDebt"), shareholdersEquity: field(row, "totalStockholderEquity", "stockholdersEquity"),
        sharesOutstanding: field(row, "commonStockSharesOutstanding"),
      });
      if (kind === "cash") Object.assign(current, {
        operatingCashFlow: field(row, "totalCashFromOperatingActivities", "operatingCashFlow"),
        capitalExpenditure: field(row, "capitalExpenditures", "capitalExpenditure"),
        dividendsPaid: field(row, "dividendsPaid", "cashDividendsPaid"),
      });
      current.raw[kind] = row;
      merged.set(key, current);
    }
  };

  const incomeAnnual = record(result.incomeStatementHistory);
  const incomeQuarterly = record(result.incomeStatementHistoryQuarterly);
  const balanceAnnual = record(result.balanceSheetHistory);
  const balanceQuarterly = record(result.balanceSheetHistoryQuarterly);
  const cashAnnual = record(result.cashflowStatementHistory);
  const cashQuarterly = record(result.cashflowStatementHistoryQuarterly);
  mergeRows(rows(incomeAnnual, "incomeStatementHistory"), "annual", "income");
  mergeRows(rows(incomeQuarterly, "incomeStatementHistory"), "quarterly", "income");
  mergeRows(rows(balanceAnnual, "balanceSheetStatements"), "annual", "balance");
  mergeRows(rows(balanceQuarterly, "balanceSheetStatements"), "quarterly", "balance");
  mergeRows(rows(cashAnnual, "cashflowStatements"), "annual", "cash");
  mergeRows(rows(cashQuarterly, "cashflowStatements"), "quarterly", "cash");

  return {
    symbol: symbol.toUpperCase(),
    asOf: new Date().toISOString(),
    marketCap: raw(summary.marketCap as YahooValue),
    trailingPe: raw(summary.trailingPE as YahooValue) ?? raw(stats.trailingPE as YahooValue),
    forwardPe: raw(stats.forwardPE as YahooValue),
    pb: raw(stats.priceToBook as YahooValue),
    epsTtm: raw(stats.trailingEps as YahooValue),
    bookValuePerShare: raw(stats.bookValue as YahooValue),
    dividendYield: raw(summary.dividendYield as YahooValue),
    roe: raw(financial.returnOnEquity as YahooValue),
    debtToEquity: raw(financial.debtToEquity as YahooValue),
    currentRatio: raw(financial.currentRatio as YahooValue),
    fiftyTwoWeekHigh: raw(summary.fiftyTwoWeekHigh as YahooValue),
    fiftyTwoWeekLow: raw(summary.fiftyTwoWeekLow as YahooValue),
    statements: [...merged.values()].sort((left, right) => right.periodDate.localeCompare(left.periodDate)),
    raw: result,
  };
}

/**
 * Yahoo quoteSummary is unofficial and may return 401. A failure is represented
 * as null so callers can retain NSE data and report the field as unavailable.
 */
export async function getYahooFundamentals(symbol: string): Promise<YahooFundamentals | null> {
  const normalized = symbol.trim().toUpperCase().replace(/\.NS$/u, "");
  const cacheKey = `${RedisKeys.fundamentals(normalized)}:yahoo:v1`;
  const cached = await getCachedJson<YahooFundamentals>(cacheKey);
  if (cached) return cached;
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(`${normalized}.NS`)}?modules=${encodeURIComponent(MODULES)}`;
    const response = await fetch(url, {
      headers: { "user-agent": "MAET market scanner/1.0", accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const parsed = parseYahooFundamentals(normalized, await response.json());
    if (parsed) await setCachedJson(cacheKey, parsed, 24 * 60 * 60);
    return parsed;
  } catch {
    return null;
  }
}
