import { desc, eq, ne } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import { withOptionalDatabase } from "../../data/drizzle/availability";
import { companies, fundamentals, quoteSnapshots, technicalSnapshots } from "../../db/schema";
import { getNseCompanyMaster, searchNseCompanyMaster } from "../../data/sources/nse-company-master";

export type ScreenerBucket = "large" | "mid" | "small" | "micro" | "unknown";
export type ScreenerSortDirection = "asc" | "desc";

export type CompanyScreenerRow = {
  symbol: string;
  name: string;
  exchange: "NSE";
  series: "EQ";
  isin: string;
  listingDate?: string;
  marketLot?: number;
  faceValue?: number;
  bseCode?: string;
  yahooSymbol?: string;
  sector?: string;
  industry?: string;
  marketCapBucket: ScreenerBucket;
  price?: number;
  changePct?: number;
  volume?: number;
  marketCap?: number;
  pe?: number;
  forwardPe?: number;
  pb?: number;
  roe?: number;
  roce?: number;
  roa?: number;
  dividendYield?: number;
  eps?: number;
  bookValuePerShare?: number;
  debtToEquity?: number;
  currentRatio?: number;
  salesGrowth?: number;
  profitGrowth?: number;
  operatingMargin?: number;
  netMargin?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  average20DayVolume?: number;
  relVolume?: number;
  revenue?: number;
  netIncome?: number;
  quoteAsOf?: string;
  fundamentalsAsOf?: string;
  quoteSource?: string;
  fundamentalsSource?: string;
  staleFundamentals?: boolean;
  source: "database" | "nse";

  // Technical Indicators (from canonical technical_snapshots)
  rsi14?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  atr14?: number;
  adx14?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  bbWidth?: number;
  distanceFromSma20Pct?: number;
  distanceFromSma50Pct?: number;
  distanceFromSma200Pct?: number;
  distanceFrom52WeekHighPct?: number;
  distanceFrom52WeekLowPct?: number;
  priceAboveSma20?: boolean;
  priceAboveSma50?: boolean;
  priceAboveSma200?: boolean;
  technicalAsOf?: string;
  technicalEngineVersion?: string;
};

export type FieldAvailability = Record<string, {
  available: boolean;
  source?: string;
  reason?: string;
}>;

/**
 * Rows a filter left out only because a filtered metric is missing (null, not 0), keyed by
 * the `fieldAvailability` key of each missing metric. A row missing two filtered metrics
 * counts once in `total` and once under each field.
 */
export type MissingDataExclusions = {
  total: number;
  byField: Record<string, number>;
};

export type CompanyScreenerResponse = {
  asOf: string;
  generatedAt: string;
  source: "database" | "nse-fallback";
  sourceSummary: string[];
  total: number;
  universeTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: CompanyScreenerRow[];
  fieldAvailability: FieldAvailability;
  excludedForMissingData: MissingDataExclusions;
  capBucketMethodology: string;
};

/** Fundamentals read from the `companies` table, whose provider is not recorded per value. */
export const COMPANY_SNAPSHOT_SOURCE = "company_snapshot";
const FUNDAMENTALS_STALE_AFTER_MS = 120 * 86_400_000;

export type CompanyScreenerParams = {
  q: string;
  page: number;
  limit: number;
  sortBy: string;
  sortDir: ScreenerSortDirection;
  numbers: Record<string, number | undefined>;
  buckets: ScreenerBucket[];
  sectors: string[];
  industries: string[];
  highBreakout: boolean;
  lowNear: boolean;
  refresh: boolean;

  // Technical filters
  priceAboveSma200: boolean;
  priceAboveSma50: boolean;
  goldenCross: boolean;
  rsiOversold: boolean;
  rsiOverbought: boolean;
};

const NUMERIC_PARAM_NAMES = [
  "price_min", "price_max", "change_pct_min", "change_pct_max", "volume_min", "volume_max",
  "rel_volume_min", "rel_volume_max", "market_cap_min", "market_cap_max", "pe_min", "pe_max",
  "pb_min", "pb_max", "roe_min", "roe_max", "roce_min", "roce_max", "dividend_yield_min",
  "dividend_yield_max", "debt_to_equity_max", "current_ratio_min", "sales_growth_min", "profit_growth_min",
  // Technical numeric filters
  "rsi_min", "rsi_max", "distance_sma200_min", "distance_sma200_max",
  "distance_52w_high_min", "distance_52w_high_max", "atr_min", "atr_max",
] as const;

const SORT_FIELDS: Record<string, keyof CompanyScreenerRow> = {
  symbol: "symbol", name: "name", price: "price", change_pct: "changePct", volume: "volume",
  rel_volume: "relVolume", market_cap: "marketCap", pe: "pe", pb: "pb", roe: "roe", roce: "roce",
  dividend_yield: "dividendYield", debt_to_equity: "debtToEquity", current_ratio: "currentRatio",
  sales_growth: "salesGrowth", profit_growth: "profitGrowth", sector: "sector",
  // Technical sort fields
  rsi: "rsi14", sma20: "sma20", sma50: "sma50", sma200: "sma200",
  distance_sma200: "distanceFromSma200Pct", distance_52w_high: "distanceFrom52WeekHighPct",
  atr: "atr14", adx: "adx14",
};

export const CAP_BUCKET_METHODOLOGY =
  "Versioned Indian market-cap ranking: ranks 1-100 large, 101-250 mid, 251+ small, using the latest stored verified market caps. Unknown means the source value is missing.";

function boundedInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

function listParam(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 50);
}

export function parseCompanyScreenerParams(params: URLSearchParams): CompanyScreenerParams {
  const numbers: Record<string, number | undefined> = {};
  for (const name of NUMERIC_PARAM_NAMES) numbers[name] = numberParam(params, name);
  const sortBy = params.get("sortBy") ?? "symbol";
  if (!SORT_FIELDS[sortBy]) throw new Error(`Unsupported sortBy: ${sortBy}`);
  const sortDir = params.get("sortDir") === "desc" ? "desc" : "asc";
  const buckets = listParam(params, "bucket_in").filter((value): value is ScreenerBucket =>
    ["large", "mid", "small", "micro", "unknown"].includes(value)
  );
  return {
    q: (params.get("q") ?? params.get("search") ?? "").trim().slice(0, 100),
    page: boundedInteger(params.get("page"), 1, 100_000),
    limit: boundedInteger(params.get("limit"), 50, 100),
    sortBy,
    sortDir,
    numbers,
    buckets,
    sectors: listParam(params, "sector_in"),
    industries: listParam(params, "industry_in"),
    highBreakout: params.get("fifty_two_week_high_breakout") === "true" || params.get("high_breakout") === "true",
    lowNear: params.get("fifty_two_week_low_near") === "true" || params.get("low_near") === "true",
    refresh: params.get("refresh") === "1",
    // Technical boolean params
    priceAboveSma200: params.get("price_above_sma200") === "true",
    priceAboveSma50: params.get("price_above_sma50") === "true",
    goldenCross: params.get("golden_cross") === "true",
    rsiOversold: params.get("rsi_oversold") === "true",
    rsiOverbought: params.get("rsi_overbought") === "true",
  };
}

function numeric(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inRange(value: number | undefined, min: number | undefined, max: number | undefined): boolean {
  if (value === undefined || Number.isNaN(value)) return min === undefined && max === undefined;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

export function percentInRange(value: number | undefined, min: number | undefined, max: number | undefined): boolean {
  // Stored ratio values are decimal fractions (e.g. 0.20 for 20%, 1.20 for 120%, -0.15 for -15%).
  // User filter boundaries (min, max) are in percentage points (e.g. 15 for 15%).
  // Convert filter boundaries to decimal fractions by dividing by 100 without magnitude heuristics.
  const minDecimal = min !== undefined ? min / 100 : undefined;
  const maxDecimal = max !== undefined ? max / 100 : undefined;
  return inRange(value, minDecimal, maxDecimal);
}

/**
 * How one row fares against the filters. `passes` covers only the metrics the row has;
 * `missing` lists the `fieldAvailability` keys of filtered metrics it lacks. A missing metric
 * never satisfies a filter (it is not treated as 0), and the caller reports it.
 */
export function screenCompanyScreenerRow(row: CompanyScreenerRow, input: CompanyScreenerParams): { passes: boolean; missing: string[] } {
  const missing = new Set<string>();
  let passes = true;
  const n = input.numbers;
  const range = (
    field: string,
    value: number | undefined,
    min: number | undefined,
    max: number | undefined,
    test: (value: number, min: number | undefined, max: number | undefined) => boolean = inRange,
  ) => {
    if (min === undefined && max === undefined) return;
    if (value === undefined || Number.isNaN(value)) missing.add(field);
    else if (!test(value, min, max)) passes = false;
  };
  /** A condition over several metrics: evaluated only when all of them are present. */
  const condition = (active: boolean, values: Record<string, number | boolean | undefined>, holds: () => boolean) => {
    if (!active) return;
    const absent = Object.entries(values).filter(([, value]) => value === undefined).map(([field]) => field);
    if (absent.length > 0) absent.forEach((field) => missing.add(field));
    else if (!holds()) passes = false;
  };
  const listed = (field: string, value: string | undefined, allowed: string[]) => {
    if (allowed.length === 0) return;
    if (!value) missing.add(field);
    else if (!allowed.some((entry) => entry.toLocaleLowerCase("en-IN") === value.toLocaleLowerCase("en-IN"))) passes = false;
  };

  const q = input.q.toLocaleLowerCase("en-IN");
  if (q && ![row.symbol, row.name, row.isin, row.bseCode ?? ""].some((value) => value.toLocaleLowerCase("en-IN").includes(q))) passes = false;
  range("price", row.price, n.price_min, n.price_max);
  range("changePct", row.changePct, n.change_pct_min, n.change_pct_max);
  range("volume", row.volume, n.volume_min, n.volume_max);
  range("relVolume", row.relVolume, n.rel_volume_min, n.rel_volume_max);
  range("marketCap", row.marketCap, n.market_cap_min, n.market_cap_max);
  range("pe", row.pe, n.pe_min, n.pe_max);
  range("pb", row.pb, n.pb_min, n.pb_max);
  range("roe", row.roe, n.roe_min, n.roe_max, percentInRange);
  range("roce", row.roce, n.roce_min, n.roce_max, percentInRange);
  range("dividendYield", row.dividendYield, n.dividend_yield_min, n.dividend_yield_max, percentInRange);
  range("debtToEquity", row.debtToEquity, undefined, n.debt_to_equity_max);
  range("currentRatio", row.currentRatio, n.current_ratio_min, undefined);
  range("salesGrowth", row.salesGrowth, n.sales_growth_min, undefined, percentInRange);
  range("profitGrowth", row.profitGrowth, n.profit_growth_min, undefined, percentInRange);
  // "unknown" means the market cap the bucket is ranked from is missing.
  if (input.buckets.length > 0 && !input.buckets.includes(row.marketCapBucket)) {
    if (row.marketCapBucket === "unknown") missing.add("marketCap");
    else passes = false;
  }
  listed("sector", row.sector, input.sectors);
  listed("industry", row.industry, input.industries);
  condition(input.highBreakout, { price: row.price, fiftyTwoWeekHigh: row.fiftyTwoWeekHigh }, () => row.price! >= row.fiftyTwoWeekHigh!);
  condition(input.lowNear, { price: row.price, fiftyTwoWeekLow: row.fiftyTwoWeekLow }, () => row.price! <= row.fiftyTwoWeekLow! * 1.05);

  // Technical Indicator filters
  range("rsi", row.rsi14, n.rsi_min, n.rsi_max);
  range("sma200", row.distanceFromSma200Pct, n.distance_sma200_min, n.distance_sma200_max);
  range("fiftyTwoWeekHigh", row.distanceFrom52WeekHighPct, n.distance_52w_high_min, n.distance_52w_high_max);
  range("atr", row.atr14, n.atr_min, n.atr_max);

  // Technical boolean condition filters
  condition(input.priceAboveSma200, { sma200: row.priceAboveSma200 }, () => row.priceAboveSma200 === true);
  condition(input.priceAboveSma50, { sma50: row.priceAboveSma50 }, () => row.priceAboveSma50 === true);
  condition(input.goldenCross, { sma50: row.sma50, sma200: row.sma200 }, () => row.sma50! > row.sma200!);
  condition(input.rsiOversold, { rsi: row.rsi14 }, () => row.rsi14! <= 30);
  condition(input.rsiOverbought, { rsi: row.rsi14 }, () => row.rsi14! >= 70);

  return { passes, missing: [...missing] };
}

export function matchesCompanyScreenerRow(row: CompanyScreenerRow, input: CompanyScreenerParams): boolean {
  const { passes, missing } = screenCompanyScreenerRow(row, input);
  return passes && missing.length === 0;
}

/** The rows that match, and a count of rows left out only because a filtered metric is missing. */
export function screenCompanyScreenerRows(
  rows: CompanyScreenerRow[],
  input: CompanyScreenerParams,
): { matches: CompanyScreenerRow[]; excludedForMissingData: MissingDataExclusions } {
  const matches: CompanyScreenerRow[] = [];
  const excludedForMissingData: MissingDataExclusions = { total: 0, byField: {} };
  for (const row of rows) {
    const { passes, missing } = screenCompanyScreenerRow(row, input);
    if (!passes) continue;
    if (missing.length === 0) {
      matches.push(row);
      continue;
    }
    excludedForMissingData.total += 1;
    for (const field of missing) {
      excludedForMissingData.byField[field] = (excludedForMissingData.byField[field] ?? 0) + 1;
    }
  }
  return { matches, excludedForMissingData };
}

function compareRows(left: CompanyScreenerRow, right: CompanyScreenerRow, input: CompanyScreenerParams): number {
  const field = SORT_FIELDS[input.sortBy];
  const a = left[field];
  const b = right[field];
  if (a === undefined && b === undefined) return left.symbol.localeCompare(right.symbol);
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return (input.sortDir === "desc" ? -result : result) || left.symbol.localeCompare(right.symbol);
}

function fieldAvailability(rows: CompanyScreenerRow[]): FieldAvailability {
  const source = (field: keyof CompanyScreenerRow) => rows.find((row) => row[field] !== undefined)?.fundamentalsSource;
  const make = (field: keyof CompanyScreenerRow, reason: string, preferredSource = "Stored database snapshot") => ({
    available: rows.some((row) => row[field] !== undefined),
    source: source(field) ?? preferredSource,
    reason,
  });
  return {
    identity: { available: rows.length > 0, source: "NSE official company master" },
    isin: make("isin", "ISIN missing from the NSE company master", "NSE official company master"),
    sector: make("sector", "Sector unavailable from the verified company snapshot"),
    industry: make("industry", "Industry unavailable from the verified company snapshot"),
    price: make("price", "No persisted quote snapshot; live page quotes may still be available", "Angel One / Yahoo quote snapshot"),
    changePct: make("changePct", "No persisted quote change snapshot", "Angel One / Yahoo quote snapshot"),
    volume: make("volume", "No persisted quote volume snapshot", "Angel One / Yahoo quote snapshot"),
    relVolume: make("relVolume", "Relative volume requires current volume and a stored 20-day average"),
    marketCap: make("marketCap", "Market cap is unavailable until a verified fundamentals source is ingested"),
    pe: make("pe", "P/E unavailable: missing verified positive EPS or source value"),
    pb: make("pb", "P/B unavailable: missing verified book value"),
    roe: make("roe", "ROE unavailable: verified net income and equity were not stored"),
    roce: make("roce", "ROCE unavailable: capital employed could not be derived"),
    dividendYield: make("dividendYield", "Dividend yield unavailable from the verified stored sources"),
    debtToEquity: make("debtToEquity", "Debt/equity unavailable: verified debt or equity is missing"),
    currentRatio: make("currentRatio", "Current ratio unavailable: current assets or liabilities are missing"),
    salesGrowth: make("salesGrowth", "Sales growth unavailable: comparable annual periods are missing"),
    profitGrowth: make("profitGrowth", "Profit growth unavailable: comparable annual periods are missing"),
    fiftyTwoWeekHigh: make("fiftyTwoWeekHigh", "52-week high unavailable: insufficient stored daily history"),
    fiftyTwoWeekLow: make("fiftyTwoWeekLow", "52-week low unavailable: insufficient stored daily history"),
    rsi: make("rsi14", "RSI(14) unavailable: insufficient daily candle history for 14-period warmup", "Canonical Indicator Engine (1.0.0)"),
    sma200: make("sma200", "200 SMA unavailable: requires 200 daily bars", "Canonical Indicator Engine (1.0.0)"),
    sma50: make("sma50", "50 SMA unavailable: requires 50 daily bars", "Canonical Indicator Engine (1.0.0)"),
    macd: make("macd", "MACD unavailable: requires 35 daily bars", "Canonical Indicator Engine (1.0.0)"),
    atr: make("atr14", "ATR unavailable: requires 14 daily bars", "Canonical Indicator Engine (1.0.0)"),
    financialStatements: { available: false, source: "Stored normalized statements", reason: "Availability is reported by the company detail endpoint" },
  };
}

async function queryDatabase(input: CompanyScreenerParams): Promise<CompanyScreenerResponse> {
  const companyRows = await db.select().from(companies).where(eq(companies.isActive, true));
  const quoteFields = ["price_min", "price_max", "change_pct_min", "change_pct_max", "volume_min", "volume_max"];
  const detailedFundamentalFields = [
    "rel_volume_min", "rel_volume_max", "roce_min", "roce_max", "current_ratio_min",
    "sales_growth_min", "profit_growth_min",
  ];
  const needsQuotes = quoteFields.some((field) => input.numbers[field] !== undefined) ||
    ["price", "change_pct", "volume"].includes(input.sortBy) ||
    input.highBreakout || input.lowNear ||
    input.priceAboveSma200 || input.priceAboveSma50;
  const needsDetailedFundamentals = detailedFundamentalFields.some((field) => input.numbers[field] !== undefined) ||
    ["rel_volume", "roce", "current_ratio", "sales_growth", "profit_growth"].includes(input.sortBy);
  const needsMarketMetrics = input.highBreakout || input.lowNear ||
    input.numbers.rel_volume_min !== undefined || input.numbers.rel_volume_max !== undefined ||
    input.sortBy === "rel_volume";

  // Keep the common symbol/name/ISIN and core valuation path to one database
  // round trip. Supabase transaction poolers can become slow when every
  // keystroke fans out into several concurrent DISTINCT ON queries.
  const latestQuotes = needsQuotes
    ? await db.selectDistinctOn([quoteSnapshots.companyId]).from(quoteSnapshots)
        .orderBy(quoteSnapshots.companyId, desc(quoteSnapshots.asOf))
    : [];
  const latestFundamentals = needsDetailedFundamentals
    ? await db.selectDistinctOn([fundamentals.companyId]).from(fundamentals)
        .where(ne(fundamentals.periodType, "market"))
        .orderBy(fundamentals.companyId, desc(fundamentals.periodDate))
    : [];
  const latestMarketMetrics = needsMarketMetrics
    ? await db.selectDistinctOn([fundamentals.companyId]).from(fundamentals)
        .where(eq(fundamentals.periodType, "market"))
        .orderBy(fundamentals.companyId, desc(fundamentals.periodDate))
    : [];

  // Load precomputed canonical technical snapshots
  let technicalRows: any[] = [];
  try {
    technicalRows = await db
      .select()
      .from(technicalSnapshots)
      .where(eq(technicalSnapshots.timeframe, "1d"));
  } catch (err) {
    // If technical snapshots table is being migrated or empty, degrade gracefully
    technicalRows = [];
  }

  const quoteByCompany = new Map(latestQuotes.map((row) => [row.companyId, row]));
  const fundamentalsByCompany = new Map(latestFundamentals.map((row) => [row.companyId, row]));
  const marketMetricsByCompany = new Map(latestMarketMetrics.map((row) => [row.companyId, row]));
  const technicalBySymbol = new Map(technicalRows.map((row) => [row.symbol, row]));

  const allRows: CompanyScreenerRow[] = companyRows.map((company) => {
    const quote = quoteByCompany.get(company.id);
    const fund = fundamentalsByCompany.get(company.id);
    const marketMetrics = marketMetricsByCompany.get(company.id);
    const tech = technicalBySymbol.get(company.symbol);
    // Provenance of the fundamentals the row displays: the latest stored statement when it was
    // loaded, otherwise the values on the company row and the time they were last written.
    const companySnapshot = [company.marketCap, company.peRatio, company.pbRatio, company.roe, company.dividendYield, company.eps, company.debtToEquity]
      .some((value) => value !== null) || company.lastFundamentalsUpdate !== null;
    const fundamentalsAsOf = fund ? fund.periodDate : company.lastFundamentalsUpdate ?? undefined;
    const fundamentalsSource = fund ? fund.source : companySnapshot ? COMPANY_SNAPSHOT_SOURCE : undefined;
    const isStale = fund?.isStale ?? Boolean(fundamentalsAsOf && Date.now() - fundamentalsAsOf.getTime() > FUNDAMENTALS_STALE_AFTER_MS);
    return {
      symbol: company.symbol,
      name: company.name,
      exchange: "NSE",
      series: "EQ",
      isin: company.isin ?? "",
      listingDate: company.listingDate?.toISOString(),
      marketLot: company.marketLot ?? undefined,
      faceValue: numeric(company.faceValue),
      bseCode: company.bseCode ?? undefined,
      yahooSymbol: company.yahooSymbol ?? `${company.symbol}.NS`,
      sector: company.sector ?? undefined,
      industry: company.industry ?? undefined,
      marketCapBucket: (company.marketCapBucket as ScreenerBucket) ?? "unknown",
      price: numeric(quote?.price),
      changePct: numeric(quote?.changePct),
      volume: quote?.volume ?? undefined,
      marketCap: numeric(fund?.marketCap ?? company.marketCap),
      pe: numeric(fund?.peRatio ?? company.peRatio),
      forwardPe: numeric(fund?.forwardPe),
      pb: numeric(fund?.pbRatio ?? company.pbRatio),
      roe: numeric(fund?.roe ?? company.roe),
      roce: numeric(fund?.roce),
      roa: numeric(fund?.returnOnAssets),
      dividendYield: numeric(fund?.dividendYield ?? company.dividendYield),
      eps: numeric(fund?.eps ?? company.eps),
      bookValuePerShare: numeric(fund?.bookValuePerShare),
      debtToEquity: numeric(fund?.debtToEquity ?? company.debtToEquity),
      currentRatio: numeric(fund?.currentRatio),
      salesGrowth: numeric(fund?.revenueGrowth),
      profitGrowth: numeric(fund?.netIncomeGrowth),
      operatingMargin: numeric(fund?.operatingMargin),
      netMargin: numeric(fund?.netMargin),
      fiftyTwoWeekHigh: numeric(marketMetrics?.fiftyTwoWeekHigh ?? fund?.fiftyTwoWeekHigh ?? tech?.high52w),
      fiftyTwoWeekLow: numeric(marketMetrics?.fiftyTwoWeekLow ?? fund?.fiftyTwoWeekLow ?? tech?.low52w),
      average20DayVolume: marketMetrics?.average20DayVolume ?? fund?.average20DayVolume ?? tech?.averageVolume20 ?? undefined,
      relVolume: numeric(marketMetrics?.relativeVolume ?? fund?.relativeVolume ?? tech?.relativeVolume20),
      revenue: numeric(fund?.revenue),
      netIncome: numeric(fund?.netIncome),
      quoteAsOf: quote?.asOf?.toISOString(),
      fundamentalsAsOf: fundamentalsAsOf?.toISOString(),
      quoteSource: quote?.source,
      fundamentalsSource,
      staleFundamentals: isStale,
      source: "database",

      // Technical Indicators
      rsi14: numeric(tech?.rsi14),
      sma20: numeric(tech?.sma20),
      sma50: numeric(tech?.sma50),
      sma200: numeric(tech?.sma200),
      ema20: numeric(tech?.ema20),
      ema50: numeric(tech?.ema50),
      ema200: numeric(tech?.ema200),
      macd: numeric(tech?.macd),
      macdSignal: numeric(tech?.macdSignal),
      macdHistogram: numeric(tech?.macdHistogram),
      atr14: numeric(tech?.atr14),
      adx14: numeric(tech?.adx14),
      bbUpper: numeric(tech?.bbUpper),
      bbMiddle: numeric(tech?.bbMiddle),
      bbLower: numeric(tech?.bbLower),
      bbWidth: numeric(tech?.bbWidth),
      distanceFromSma20Pct: numeric(tech?.distanceFromSma20Pct),
      distanceFromSma50Pct: numeric(tech?.distanceFromSma50Pct),
      distanceFromSma200Pct: numeric(tech?.distanceFromSma200Pct),
      distanceFrom52WeekHighPct: numeric(tech?.distanceFrom52WeekHighPct),
      distanceFrom52WeekLowPct: numeric(tech?.distanceFrom52WeekLowPct),
      priceAboveSma20: tech?.priceAboveSma20 ?? undefined,
      priceAboveSma50: tech?.priceAboveSma50 ?? undefined,
      priceAboveSma200: tech?.priceAboveSma200 ?? undefined,
      technicalAsOf: tech?.asOf?.toISOString(),
      technicalEngineVersion: tech?.indicatorEngineVersion ?? undefined,
    };
  });
  const { matches, excludedForMissingData } = screenCompanyScreenerRows(allRows, input);
  const filtered = matches.sort((a, b) => compareRows(a, b, input));
  const start = (input.page - 1) * input.limit;
  const generatedAt = new Date().toISOString();
  return {
    asOf: generatedAt,
    generatedAt,
    source: "database",
    sourceSummary: ["NSE company master", "PostgreSQL stored snapshots"],
    total: filtered.length,
    universeTotal: allRows.length,
    page: input.page,
    pageSize: input.limit,
    pageCount: Math.ceil(filtered.length / input.limit),
    items: filtered.slice(start, start + input.limit),
    fieldAvailability: fieldAvailability(allRows),
    excludedForMissingData,
    capBucketMethodology: CAP_BUCKET_METHODOLOGY,
  };
}

async function queryNseFallback(input: CompanyScreenerParams): Promise<CompanyScreenerResponse> {
  const all = await getNseCompanyMaster(input.refresh);
  const requiresStoredData = Object.values(input.numbers).some((value) => value !== undefined) ||
    input.sectors.length > 0 || input.industries.length > 0 || input.highBreakout || input.lowNear ||
    input.priceAboveSma200 || input.priceAboveSma50 || input.goldenCross || input.rsiOversold || input.rsiOverbought ||
    input.buckets.some((bucket) => bucket !== "unknown");
  // The NSE master carries no stored metrics, so any metric filter leaves a row out for missing data.
  const searched: CompanyScreenerRow[] = searchNseCompanyMaster(all, input.q).map((company) => ({
    ...company,
    marketCapBucket: "unknown",
    yahooSymbol: `${company.symbol}.NS`,
    source: "nse",
  }));
  const { matches: rows, excludedForMissingData } = screenCompanyScreenerRows(searched, { ...input, q: "" });
  const start = (input.page - 1) * input.limit;
  const generatedAt = new Date().toISOString();
  return {
    asOf: generatedAt,
    generatedAt,
    source: "nse-fallback",
    sourceSummary: requiresStoredData
      ? ["NSE official company master", "Database unavailable: enriched technical and fundamental predicates cannot be evaluated"]
      : ["NSE official company master", "Database unavailable: enriched filters are disabled"],
    total: rows.length,
    universeTotal: all.length,
    page: input.page,
    pageSize: input.limit,
    pageCount: Math.ceil(rows.length / input.limit),
    items: rows.slice(start, start + input.limit),
    fieldAvailability: fieldAvailability(rows),
    excludedForMissingData,
    capBucketMethodology: CAP_BUCKET_METHODOLOGY,
  };
}

export async function queryCompanyScreener(input: CompanyScreenerParams): Promise<CompanyScreenerResponse> {
  try {
    return await withOptionalDatabase(() => queryDatabase(input));
  } catch {
    return queryNseFallback(input);
  }
}
