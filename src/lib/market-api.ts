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
  "1W": { label: string; range: string };
  "5y": { label: string; range: string };
  "max": { label: string; range: string };
};

export type MarketCandlesResponse = {
  symbol: string;
  timeframe: MarketCandle["tf"];
  range: string;
  source: string;
  delayed: boolean;
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
const defaultApiUrl = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://stock-market-backend.onrender.com";
export const API_BASE_URL = (configuredApiUrl || defaultApiUrl).replace(/\/$/, "");

export async function fetchMarketQuotes(
  symbols: string[],
  signal?: AbortSignal
): Promise<MarketQuotesResponse> {
  const params = new URLSearchParams({ symbols: symbols.join(",") });
  const response = await fetch(`${API_BASE_URL}/api/market/quotes?${params}`, { signal });
  if (!response.ok) throw new Error(`Quote service returned ${response.status}`);
  return response.json() as Promise<MarketQuotesResponse>;
}

export async function fetchMarketCandles(
  symbol: string,
  timeframe: MarketCandle["tf"],
  range: string,
  signal?: AbortSignal
): Promise<MarketCandlesResponse> {
  const params = new URLSearchParams({ symbol, tf: timeframe, range });
  const response = await fetch(`${API_BASE_URL}/api/market/candles?${params}`, { signal });
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
