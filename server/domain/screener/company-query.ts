import { desc, eq } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import { companies, fundamentals, quoteSnapshots } from "../../db/schema";
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
};

export type FieldAvailability = Record<string, {
  available: boolean;
  source?: string;
  reason?: string;
}>;

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
  capBucketMethodology: string;
};

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
};

const NUMERIC_PARAM_NAMES = [
  "price_min", "price_max", "change_pct_min", "change_pct_max", "volume_min", "volume_max",
  "rel_volume_min", "rel_volume_max", "market_cap_min", "market_cap_max", "pe_min", "pe_max",
  "pb_min", "pb_max", "roe_min", "roe_max", "roce_min", "roce_max", "dividend_yield_min",
  "dividend_yield_max", "debt_to_equity_max", "current_ratio_min", "sales_growth_min", "profit_growth_min",
] as const;

const SORT_FIELDS: Record<string, keyof CompanyScreenerRow> = {
  symbol: "symbol", name: "name", price: "price", change_pct: "changePct", volume: "volume",
  rel_volume: "relVolume", market_cap: "marketCap", pe: "pe", pb: "pb", roe: "roe", roce: "roce",
  dividend_yield: "dividendYield", debt_to_equity: "debtToEquity", current_ratio: "currentRatio",
  sales_growth: "salesGrowth", profit_growth: "profitGrowth", sector: "sector",
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
    highBreakout: params.get("fifty_two_week_high_breakout") === "true",
    lowNear: params.get("fifty_two_week_low_near") === "true",
    refresh: params.get("refresh") === "1",
  };
}

function numeric(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inRange(value: number | undefined, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && (value === undefined || value < min)) return false;
  if (max !== undefined && (value === undefined || value > max)) return false;
  return true;
}

function percentInRange(value: number | undefined, min: number | undefined, max: number | undefined): boolean {
  const normalize = (bound: number | undefined) =>
    value !== undefined && Math.abs(value) <= 1 && bound !== undefined && Math.abs(bound) > 1 ? bound / 100 : bound;
  return inRange(value, normalize(min), normalize(max));
}

function matches(row: CompanyScreenerRow, input: CompanyScreenerParams): boolean {
  const q = input.q.toLocaleLowerCase("en-IN");
  if (q && ![row.symbol, row.name, row.isin, row.bseCode ?? ""].some((value) => value.toLocaleLowerCase("en-IN").includes(q))) return false;
  const n = input.numbers;
  if (!inRange(row.price, n.price_min, n.price_max)) return false;
  if (!inRange(row.changePct, n.change_pct_min, n.change_pct_max)) return false;
  if (!inRange(row.volume, n.volume_min, n.volume_max)) return false;
  if (!inRange(row.relVolume, n.rel_volume_min, n.rel_volume_max)) return false;
  if (!inRange(row.marketCap, n.market_cap_min, n.market_cap_max)) return false;
  if (!inRange(row.pe, n.pe_min, n.pe_max)) return false;
  if (!inRange(row.pb, n.pb_min, n.pb_max)) return false;
  if (!percentInRange(row.roe, n.roe_min, n.roe_max)) return false;
  if (!percentInRange(row.roce, n.roce_min, n.roce_max)) return false;
  if (!percentInRange(row.dividendYield, n.dividend_yield_min, n.dividend_yield_max)) return false;
  if (!inRange(row.debtToEquity, undefined, n.debt_to_equity_max)) return false;
  if (!inRange(row.currentRatio, n.current_ratio_min, undefined)) return false;
  if (!percentInRange(row.salesGrowth, n.sales_growth_min, undefined)) return false;
  if (!percentInRange(row.profitGrowth, n.profit_growth_min, undefined)) return false;
  if (input.buckets.length > 0 && !input.buckets.includes(row.marketCapBucket)) return false;
  if (input.sectors.length > 0 && (!row.sector || !input.sectors.includes(row.sector))) return false;
  if (input.industries.length > 0 && (!row.industry || !input.industries.includes(row.industry))) return false;
  if (input.highBreakout && (row.price === undefined || row.fiftyTwoWeekHigh === undefined || row.price < row.fiftyTwoWeekHigh)) return false;
  if (input.lowNear && (row.price === undefined || row.fiftyTwoWeekLow === undefined || row.price > row.fiftyTwoWeekLow * 1.05)) return false;
  return true;
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
    financialStatements: { available: false, source: "Stored normalized statements", reason: "Availability is reported by the company detail endpoint" },
  };
}

async function queryDatabase(input: CompanyScreenerParams): Promise<CompanyScreenerResponse> {
  const [companyRows, latestQuotes, latestFundamentals, latestMarketMetrics] = await Promise.all([
    db.select().from(companies).where(eq(companies.isActive, true)),
    db.selectDistinctOn([quoteSnapshots.companyId]).from(quoteSnapshots)
      .orderBy(quoteSnapshots.companyId, desc(quoteSnapshots.asOf)),
    db.selectDistinctOn([fundamentals.companyId]).from(fundamentals)
      .orderBy(fundamentals.companyId, desc(fundamentals.periodDate)),
    db.selectDistinctOn([fundamentals.companyId]).from(fundamentals)
      .where(eq(fundamentals.periodType, "market"))
      .orderBy(fundamentals.companyId, desc(fundamentals.periodDate)),
  ]);
  const quoteByCompany = new Map(latestQuotes.map((row) => [row.companyId, row]));
  const fundamentalsByCompany = new Map(latestFundamentals.map((row) => [row.companyId, row]));
  const marketMetricsByCompany = new Map(latestMarketMetrics.map((row) => [row.companyId, row]));
  const allRows: CompanyScreenerRow[] = companyRows.map((company) => {
    const quote = quoteByCompany.get(company.id);
    const fund = fundamentalsByCompany.get(company.id);
    const marketMetrics = marketMetricsByCompany.get(company.id);
    const fundamentalsAsOf = fund?.periodDate;
    const isStale = fund?.isStale ?? Boolean(fundamentalsAsOf && Date.now() - fundamentalsAsOf.getTime() > 120 * 86_400_000);
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
      fiftyTwoWeekHigh: numeric(marketMetrics?.fiftyTwoWeekHigh ?? fund?.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: numeric(marketMetrics?.fiftyTwoWeekLow ?? fund?.fiftyTwoWeekLow),
      average20DayVolume: marketMetrics?.average20DayVolume ?? fund?.average20DayVolume ?? undefined,
      relVolume: numeric(marketMetrics?.relativeVolume ?? fund?.relativeVolume),
      revenue: numeric(fund?.revenue),
      netIncome: numeric(fund?.netIncome),
      quoteAsOf: quote?.asOf.toISOString(),
      fundamentalsAsOf: fundamentalsAsOf?.toISOString(),
      quoteSource: quote?.source,
      fundamentalsSource: fund?.source ?? company.dataSource,
      staleFundamentals: isStale,
      source: "database",
    };
  });
  const filtered = allRows.filter((row) => matches(row, input)).sort((a, b) => compareRows(a, b, input));
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
    capBucketMethodology: CAP_BUCKET_METHODOLOGY,
  };
}

async function queryNseFallback(input: CompanyScreenerParams): Promise<CompanyScreenerResponse> {
  const all = await getNseCompanyMaster(input.refresh);
  const requiresStoredData = Object.values(input.numbers).some((value) => value !== undefined) ||
    input.sectors.length > 0 || input.industries.length > 0 || input.highBreakout || input.lowNear ||
    input.buckets.some((bucket) => bucket !== "unknown");
  const filtered = requiresStoredData ? [] : searchNseCompanyMaster(all, input.q).filter(() =>
    input.buckets.length === 0 || input.buckets.includes("unknown")
  );
  const rows: CompanyScreenerRow[] = filtered.map((company) => ({
    ...company,
    marketCapBucket: "unknown",
    yahooSymbol: `${company.symbol}.NS`,
    source: "nse",
  }));
  const start = (input.page - 1) * input.limit;
  const generatedAt = new Date().toISOString();
  return {
    asOf: generatedAt,
    generatedAt,
    source: "nse-fallback",
    sourceSummary: ["NSE official company master", "Database unavailable: enriched filters are disabled"],
    total: rows.length,
    universeTotal: all.length,
    page: input.page,
    pageSize: input.limit,
    pageCount: Math.ceil(rows.length / input.limit),
    items: rows.slice(start, start + input.limit),
    fieldAvailability: fieldAvailability(rows),
    capBucketMethodology: CAP_BUCKET_METHODOLOGY,
  };
}

export async function queryCompanyScreener(input: CompanyScreenerParams): Promise<CompanyScreenerResponse> {
  try {
    return await queryDatabase(input);
  } catch {
    return queryNseFallback(input);
  }
}
