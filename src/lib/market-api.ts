export type MarketQuote = {
  exchange: "NSE" | "BSE";
  symbol: string;
  price: number;
  volume: number;
  ts: string;
  source: "angelone" | "yahoo" | "nse";
  previousClose?: number;
  change?: number;
  changePct?: number;
  marketState?: string;
  currency?: string;
};

export type MarketQuotesResponse = {
  asOf: string;
  source: string;
  delayed: boolean;
  quotes: MarketQuote[];
  errors: Array<{ symbol: string; message: string }>;
};

export type MarketCompany = {
  symbol: string;
  name: string;
  exchange: "NSE";
  series: "EQ";
  isin: string;
  listingDate?: string;
  paidUpValue?: number;
  marketLot?: number;
  faceValue?: number;
  bseCode?: string;
  yahooSymbol?: string;
  // Extended fundamentals — populated after daily-processor sync
  sector?: string;
  industry?: string;
  marketCap?: number;
  pe?: number;
  pb?: number;
  roe?: number;
  dividendYield?: number;
  eps?: number;
  price?: number;
  changePct?: number;
  volume?: number;
  forwardPe?: number;
  bookValuePerShare?: number;
  roce?: number;
  roa?: number;
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
  marketCapBucket: "large" | "mid" | "small" | "micro" | "unknown";
  quoteAsOf?: string;
  fundamentalsAsOf?: string;
  quoteSource?: string;
  fundamentalsSource?: string;
  staleFundamentals?: boolean;
  source: "database" | "nse";
};

export type MarketFieldAvailability = Record<string, {
  available: boolean;
  source?: string;
  reason?: string;
}>;

export type MarketCompaniesResponse = {
  asOf: string;
  generatedAt: string;
  source: "database" | "nse-fallback";
  sourceSummary: string[];
  total: number;
  universeTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: MarketCompany[];
  fieldAvailability: MarketFieldAvailability;
  capBucketMethodology: string;
};

export type ScreenerQuery = Record<string, string | number | boolean | string[] | undefined>;

export type FinancialStatement = {
  id: string;
  periodDate: string;
  periodType: "annual" | "quarterly" | string;
  statementType: "balance_sheet" | "income_statement" | "cash_flow" | "combined" | string;
  fiscalYear: number;
  currency: string;
  source: string;
  asOf: string;
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
};

export type CompanyDetailResponse = {
  generatedAt: string;
  master: {
    symbol: string; name: string; exchange: string; series: string; isin: string;
    bseCode?: string; yahooSymbol?: string; sector?: string; industry?: string;
    marketCapBucket: string; listingDate?: string;
  };
  quote?: { price: number; changePct?: number; volume?: number; marketCap?: number; asOf: string; source: string };
  fundamentals?: Record<string, string | number | boolean | undefined> & { asOf: string; source: string; stale: boolean };
  statements: { annual: FinancialStatement[]; quarterly: FinancialStatement[] };
  candles: MarketCandle[];
  availability: MarketFieldAvailability;
};

export type MarketCandle = {
  symbol: string;
  tf: "1m" | "5m" | "15m" | "1h" | "1d" | "1wk";
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Extended timeframe support for charts
export type ChartTimeframe = {
  "1m": { label: string; range: string };
  "5m": { label: string; range: string };
  "10d": { label: string; range: string };
  "15m": { label: string; range: string };
  "1h": { label: string; range: string };
  "6mo": { label: string; range: string };
  "1D": { label: string; range: string };
  "3Y": { label: string; range: string };
  "5y": { label: string; range: string };
  "max": { label: string; range: string };
};

export type MarketCandlesResponse = {
  symbol: string;
  timeframe: MarketCandle["tf"];
  range: string;
  source: string;
  delayed: boolean;
  persisted?: boolean;
  asOf: string;
  candles: MarketCandle[];
};

export type BacktestRequest = {
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "1d" | "1wk";
  range: "5d" | "1mo" | "3mo" | "1y" | "2y" | "5y";
  strategy: "sma_cross" | "rsi";
  initialCapital: number;
  feeBps: number;
  params: Record<string, number>;
};

export type BacktestResponse = {
  asOf: string;
  source: "yahoo";
  delayed: true;
  symbol: string;
  timeframe: BacktestRequest["timeframe"];
  range: BacktestRequest["range"];
  candleCount: number;
  strategy: { name: BacktestRequest["strategy"]; params: Record<string, number> };
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  winRatePct: number;
  profitFactor: number | null;
  avgTradePnl: number;
  trades: Array<{
    entryTs: string;
    exitTs: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    pnl: number;
    returnPct: number;
  }>;
  equity: Array<{ ts: string; value: number }>;
  monthlyReturns: Array<{ month: string; returnPct: number }>;
};

const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
export const API_BASE_URL = (configuredApiUrl ?? "").replace(/\/$/, "");

async function fetchMarketEndpoint(path: string, signal?: AbortSignal): Promise<Response> {
  if (!API_BASE_URL) return fetch(path, { signal });

  const primaryUrl = `${API_BASE_URL}${path}`;
  const controller = new AbortController();
  // Render free instances and the Supabase transaction pooler can need several
  // seconds after an idle period. Keep a bounded timeout, but do not abandon a
  // healthy database query before the backend has had a fair chance to reply.
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 12_000);
  const abortPrimary = () => controller.abort();
  signal?.addEventListener("abort", abortPrimary, { once: true });

  try {
    const response = await fetch(primaryUrl, { signal: controller.signal });
    if (response.ok) return response;
  } catch (error) {
    if (signal?.aborted) throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortPrimary);
  }

  // A same-origin server route keeps market data available when the optional
  // Render broker-stream service is sleeping or temporarily unhealthy.
  return fetch(path, { signal });
}

export async function fetchMarketQuotes(
  symbols: string[],
  signal?: AbortSignal
): Promise<MarketQuotesResponse> {
  const params = new URLSearchParams({ symbols: symbols.join(",") });
  const response = await fetchMarketEndpoint(`/api/market/quotes?${params}`, signal);
  if (!response.ok) throw new Error(`Quote service returned ${response.status}`);
  return response.json() as Promise<MarketQuotesResponse>;
}

export async function fetchMarketCompanies(
  page: number,
  limit: number,
  search: string,
  signal?: AbortSignal,
  query: ScreenerQuery = {}
): Promise<MarketCompaniesResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) params.set("q", search.trim());
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "" || value === false) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const response = await fetchMarketEndpoint(`/api/market/companies?${params}`, signal);
  if (!response.ok) throw new Error(`Company master returned ${response.status}`);
  return response.json() as Promise<MarketCompaniesResponse>;
}

export async function fetchCompanyDetail(symbol: string, signal?: AbortSignal): Promise<CompanyDetailResponse> {
  const params = new URLSearchParams({ symbol });
  const response = await fetchMarketEndpoint(`/api/market/company?${params}`, signal);
  if (!response.ok) throw new Error(`Company detail returned ${response.status}`);
  return response.json() as Promise<CompanyDetailResponse>;
}

export async function fetchMarketCandles(
  symbol: string,
  timeframe: MarketCandle["tf"],
  range: string,
  signal?: AbortSignal
): Promise<MarketCandlesResponse> {
  const params = new URLSearchParams({ symbol, tf: timeframe, range });
  const path = `/api/market/candles?${params}`;

  // Historical data is delayed and does not depend on Render's live broker
  // process. Prefer the same-origin server route in the browser so a degraded
  // Render database/Yahoo worker does not emit a failed request before the
  // already-working Vercel fallback is used.
  let response: Response;
  if (typeof window !== "undefined" && API_BASE_URL) {
    // Do not forward TanStack Query's observer signal here. During route/layout
    // hydration that signal can be replaced before this fast serverless request
    // settles, producing an abort/refetch loop. Query keys still prevent a
    // superseded timeframe response from being displayed.
    response = await fetch(path);
    if (!response.ok) response = await fetchMarketEndpoint(path, signal);
  } else {
    response = await fetchMarketEndpoint(path, signal);
  }
  if (!response.ok) throw new Error(`Candle service returned ${response.status}`);
  return response.json() as Promise<MarketCandlesResponse>;
}

export async function runMarketBacktest(
  input: BacktestRequest,
  signal?: AbortSignal
): Promise<BacktestResponse> {
  const response = await fetch(`${API_BASE_URL}/api/backtest/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    let message = `Backtest service returned ${response.status}`;
    try {
      const error = await response.json() as { statusMessage?: string; message?: string };
      message = error.statusMessage ?? error.message ?? message;
    } catch {
      // Keep the HTTP status fallback.
    }
    throw new Error(message);
  }
  return response.json() as Promise<BacktestResponse>;
}
