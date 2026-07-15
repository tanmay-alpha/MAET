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
  /** Sector from Yahoo assetProfile (e.g. "Technology", "Financial Services") */
  sector?: string;
  /** Industry from Yahoo assetProfile (e.g. "Software—Application") */
  industry?: string;
  statements: YahooStatement[];
  source: "yahoo_quote_summary" | "yahoo_timeseries";
  raw: Record<string, unknown>;
};

// assetProfile contains sector, industry, and company description from Yahoo.
const MODULES = [
  "summaryDetail", "defaultKeyStatistics", "financialData",
  "assetProfile",
  "incomeStatementHistory", "incomeStatementHistoryQuarterly",
  "balanceSheetHistory", "balanceSheetHistoryQuarterly",
  "cashflowStatementHistory", "cashflowStatementHistoryQuarterly",
].join(",");

let quoteSummaryRequiresCrumb = false;

const TIMESERIES_FIELDS = [
  "TotalRevenue", "CostOfRevenue", "OperatingIncome", "EBITDA", "EBIT",
  "InterestExpense", "TaxProvision", "NetIncome", "TotalAssets", "CurrentAssets",
  "Inventory", "CashCashEquivalentsAndShortTermInvestments",
  "TotalLiabilitiesNetMinorityInterest", "CurrentLiabilities", "TotalDebt",
  "StockholdersEquity", "OperatingCashFlow", "CapitalExpenditure",
  "CashDividendsPaid", "DilutedAverageShares",
] as const;

const TIMESERIES_TYPES = [
  "trailingMarketCap", "trailingPeRatio", "trailingPbRatio", "trailingDividendYield",
  ...TIMESERIES_FIELDS.flatMap((name) => [`annual${name}`, `quarterly${name}`]),
];

const TIMESERIES_FIELD_MAP: Record<string, keyof YahooStatement> = {
  TotalRevenue: "revenue", CostOfRevenue: "costOfRevenue", OperatingIncome: "operatingIncome",
  EBITDA: "ebitda", EBIT: "ebit", InterestExpense: "interestExpense", TaxProvision: "taxExpense",
  NetIncome: "netIncome", TotalAssets: "totalAssets", CurrentAssets: "currentAssets",
  Inventory: "inventory", CashCashEquivalentsAndShortTermInvestments: "cashAndEquivalents",
  TotalLiabilitiesNetMinorityInterest: "totalLiabilities", CurrentLiabilities: "currentLiabilities",
  TotalDebt: "totalDebt", StockholdersEquity: "shareholdersEquity",
  OperatingCashFlow: "operatingCashFlow", CapitalExpenditure: "capitalExpenditure",
  CashDividendsPaid: "dividendsPaid", DilutedAverageShares: "sharesOutstanding",
};

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
  const assetProfile = record(result.assetProfile);

  // Extract sector and industry strings from assetProfile
  const sector = typeof assetProfile.sector === "string" && assetProfile.sector.trim()
    ? assetProfile.sector.trim() : undefined;
  const industry = typeof assetProfile.industry === "string" && assetProfile.industry.trim()
    ? assetProfile.industry.trim() : undefined;

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
    sector,
    industry,
    statements: [...merged.values()].sort((left, right) => right.periodDate.localeCompare(left.periodDate)),
    source: "yahoo_quote_summary",
    raw: result,
  };
}

type YahooTimeseriesPoint = {
  asOfDate?: string;
  currencyCode?: string;
  reportedValue?: YahooValue;
};

function safeRatio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator === 0) return undefined;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : undefined;
}

/** Normalize Yahoo's public fundamentals-timeseries response. */
export function parseYahooTimeseriesFundamentals(
  symbol: string,
  payload: unknown,
  chartMeta: unknown = {},
): YahooFundamentals | null {
  const root = record(payload);
  const timeseries = record(root.timeseries);
  const results = Array.isArray(timeseries.result) ? timeseries.result.map(record) : [];
  if (results.length === 0) return null;

  const statements = new Map<string, YahooStatement>();
  const metrics = new Map<string, number>();
  for (const result of results) {
    const meta = record(result.meta);
    const types = Array.isArray(meta.type) ? meta.type : [];
    const type = typeof types[0] === "string" ? types[0] : undefined;
    if (!type) continue;
    const points = Array.isArray(result[type]) ? result[type].map(record) as YahooTimeseriesPoint[] : [];
    const latest = points.at(-1);
    const latestValue = raw(latest?.reportedValue);
    if (latestValue !== undefined && type.startsWith("trailing")) metrics.set(type, latestValue);

    const match = /^(annual|quarterly)(.+)$/u.exec(type);
    if (!match) continue;
    const periodType = match[1] as YahooStatement["periodType"];
    const statementField = TIMESERIES_FIELD_MAP[match[2]];
    if (!statementField) continue;
    for (const point of points) {
      const value = raw(point.reportedValue);
      if (!point.asOfDate || value === undefined) continue;
      const key = `${periodType}:${point.asOfDate}`;
      const current = statements.get(key) ?? {
        periodDate: new Date(`${point.asOfDate}T00:00:00Z`).toISOString(),
        periodType,
        fiscalYear: Number(point.asOfDate.slice(0, 4)),
        currency: point.currencyCode ?? "INR",
        raw: {},
      };
      (current as unknown as Record<string, unknown>)[statementField] = value;
      current.raw[type] = point;
      statements.set(key, current);
    }
  }

  const normalizedStatements = [...statements.values()].sort((a, b) => b.periodDate.localeCompare(a.periodDate));
  const quarterly = normalizedStatements.filter((statement) => statement.periodType === "quarterly");
  const latestBalance = normalizedStatements.find((statement) =>
    statement.shareholdersEquity !== undefined || statement.totalAssets !== undefined
  );
  const latestFour = quarterly.slice(0, 4);
  const ttmNetIncome = latestFour.length === 4 && latestFour.every((statement) => statement.netIncome !== undefined)
    ? latestFour.reduce((sum, statement) => sum + (statement.netIncome ?? 0), 0)
    : undefined;
  const shares = quarterly.find((statement) => statement.sharesOutstanding !== undefined)?.sharesOutstanding
    ?? latestBalance?.sharesOutstanding;
  const meta = record(chartMeta);

  return {
    symbol: symbol.toUpperCase(),
    asOf: new Date().toISOString(),
    marketCap: metrics.get("trailingMarketCap"),
    trailingPe: metrics.get("trailingPeRatio"),
    pb: metrics.get("trailingPbRatio"),
    epsTtm: safeRatio(ttmNetIncome, shares),
    bookValuePerShare: safeRatio(latestBalance?.shareholdersEquity, shares),
    dividendYield: metrics.get("trailingDividendYield"),
    roe: safeRatio(ttmNetIncome, latestBalance?.shareholdersEquity),
    debtToEquity: safeRatio(latestBalance?.totalDebt, latestBalance?.shareholdersEquity),
    currentRatio: safeRatio(latestBalance?.currentAssets, latestBalance?.currentLiabilities),
    fiftyTwoWeekHigh: raw(meta.fiftyTwoWeekHigh as YahooValue),
    fiftyTwoWeekLow: raw(meta.fiftyTwoWeekLow as YahooValue),
    statements: normalizedStatements,
    source: "yahoo_timeseries",
    raw: { timeseries: root, chartMeta: meta },
  };
}

async function getYahooTimeseriesFundamentals(symbol: string): Promise<YahooFundamentals | null> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const fromSeconds = nowSeconds - 6 * 366 * 24 * 60 * 60;
  const ticker = `${symbol}.NS`;
  const timeseriesUrl = new URL(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}`);
  timeseriesUrl.searchParams.set("type", TIMESERIES_TYPES.join(","));
  timeseriesUrl.searchParams.set("period1", String(fromSeconds));
  timeseriesUrl.searchParams.set("period2", String(nowSeconds + 86_400));
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const headers = { "user-agent": "Mozilla/5.0 (compatible; MAET/1.0)", accept: "application/json" };
  const [timeseriesResponse, chartResponse] = await Promise.all([
    fetch(timeseriesUrl, { headers, signal: AbortSignal.timeout(20_000) }),
    fetch(chartUrl, { headers, signal: AbortSignal.timeout(20_000) }),
  ]);
  if (!timeseriesResponse.ok) return null;
  const timeseriesPayload = await timeseriesResponse.json();
  let chartMeta: unknown = {};
  if (chartResponse.ok) {
    const chartPayload = record(await chartResponse.json());
    const chart = record(chartPayload.chart);
    const chartResults = Array.isArray(chart.result) ? chart.result.map(record) : [];
    chartMeta = record(chartResults[0]?.meta);
  }
  return parseYahooTimeseriesFundamentals(symbol, timeseriesPayload, chartMeta);
}

/**
 * Yahoo quoteSummary is unofficial and may return 401. A failure is represented
 * as null so callers can retain NSE data and report the field as unavailable.
 */
export async function getYahooFundamentals(symbol: string): Promise<YahooFundamentals | null> {
  const normalized = symbol.trim().toUpperCase().replace(/\.NS$/u, "");
  const cacheKey = `${RedisKeys.fundamentals(normalized)}:yahoo:v2`;
  const cached = await getCachedJson<YahooFundamentals>(cacheKey);
  if (cached) return cached;
  try {
    let parsed: YahooFundamentals | null = null;
    if (!quoteSummaryRequiresCrumb) {
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(`${normalized}.NS`)}?modules=${encodeURIComponent(MODULES)}`;
      const response = await fetch(url, {
        headers: { "user-agent": "MAET market scanner/1.0", accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 401 || response.status === 403) quoteSummaryRequiresCrumb = true;
      if (response.ok) parsed = parseYahooFundamentals(normalized, await response.json());
    }
    if (!parsed) parsed = await getYahooTimeseriesFundamentals(normalized);
    if (parsed) await setCachedJson(cacheKey, parsed, 24 * 60 * 60);
    return parsed;
  } catch {
    return null;
  }
}
