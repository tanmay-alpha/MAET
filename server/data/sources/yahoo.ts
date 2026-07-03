import type { Candle, Tick } from "../../../shared/types";
import { UpstreamDegradedError, UpstreamPermanentError } from "../../../shared/types";
import { getCachedJson, setCachedJson } from "../../data/redis/client";
import { RedisKeys } from "../../data/redis/keys";

// Upstream error classes live in shared/types/errors.ts so that all data/sources/*
// modules can depend on them without coupling to a specific source (yahoo, nse, ...).
// Per spec section 4, data/* may import from shared/ and infra/ but not from sibling data/*.

export { UpstreamDegradedError, UpstreamPermanentError };

const HOST = "query1.finance.yahoo.com";
const MAX_CONCURRENT_REQUESTS = 4;

let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

export function _resetCircuitForTest(): void {
  activeRequests = 0;
  requestWaiters.splice(0).forEach((release) => release());
}

async function withRequestSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  }
  activeRequests++;
  try {
    return await fn();
  } finally {
    activeRequests--;
    requestWaiters.shift()?.();
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const tries = 3;
  let lastErr: unknown;

  for (let i = 0; i < tries; i++) {
    try {
      const r = await fn();
      return r;
    } catch (e) {
      lastErr = e;
      if (e instanceof UpstreamPermanentError) throw e;
      if (i === tries - 1) break;
      const wait = 200 * Math.pow(2, i) + Math.floor(Math.random() * 100);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

type YahooChartResp = {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice: number;
        regularMarketVolume: number;
        symbol: string;
        chartPreviousClose?: number;
        previousClose?: number;
        marketState?: string;
        currency?: string;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open: Array<number | null>;
          high: Array<number | null>;
          low: Array<number | null>;
          close: Array<number | null>;
          volume: Array<number | null>;
        }>;
      };
    }>;
    error?: unknown;
  };
};

function symbolToTicker(symbol: string): string {
  if (symbol.startsWith("^")) return symbol;
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) return symbol;
  return `${symbol}.NS`;
}

export async function getQuote(
  symbol: string,
  tickerOverride?: string,
  exchangeOverride?: "NSE" | "BSE"
): Promise<Tick> {
  const ticker = tickerOverride ?? symbolToTicker(symbol);
  return withRetry(async () => {
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
    const res = await withRequestSlot(() =>
      fetch(url, { headers: { "User-Agent": "stock-market-backend/1.0" } })
    );
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (res.status === 404) throw new UpstreamPermanentError(`symbol not found: ${ticker}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const exchange = exchangeOverride ?? (ticker.endsWith(".BO") ? "BSE" : "NSE");
    const previousClose = r.meta.chartPreviousClose ?? r.meta.previousClose;
    const change = previousClose ? r.meta.regularMarketPrice - previousClose : undefined;
    return {
      exchange,
      symbol: symbol.replace(/\.(NS|BO)$/, ""),
      price: r.meta.regularMarketPrice,
      volume: r.meta.regularMarketVolume,
      ts: r.meta.regularMarketTime
        ? new Date(r.meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: "yahoo",
      previousClose,
      change,
      changePct: previousClose && change !== undefined ? (change / previousClose) * 100 : undefined,
      marketState: r.meta.marketState,
      currency: r.meta.currency,
    } satisfies Tick;
  });
}

export async function getCandles(
  ticker: string,
  from: Date,
  to: Date,
  tf: Candle["tf"]
): Promise<Candle[]> {
  // --- Redis cache lookup ---
  const cacheKey = RedisKeys.candlesKey("NSE", ticker, tf,
    Math.floor(from.getTime() / 1000).toString(),
    Math.floor(to.getTime() / 1000).toString(),
  );
  const cached = await getCachedJson<Candle[]>(cacheKey);
  if (cached) return cached;

  // --- Range fallback: Yahoo limits per interval ---
  // 1m: max 7 days, 5m: max 30 days, 15m: max 60 days, 1h: max 2 years, 1d+: no limit
  const maxDaysForTf: Record<string, number> = {
    "1m":  7,           // 7 days of 1-minute bars
    "5m":  30,          // 30 days of 5-minute bars
    "15m": 60,          // 60 days of 15-minute bars
    "1h":  730,         // ~2 years of hourly bars
    "1d":  36500,       // no practical limit for daily+
    "1wk": 36500,
  };
  const maxDays = maxDaysForTf[tf] ?? 36500;
  const requestedDays = (to.getTime() - from.getTime()) / 86_400_000;
  let fromDate = from;
  if (requestedDays > maxDays) {
    fromDate = new Date(to.getTime() - maxDays * 86_400_000);
  }

  return withRetry(async () => {
    const fullTicker = symbolToTicker(ticker);
    const period1 = Math.floor(fromDate.getTime() / 1000);
    const period2 = Math.floor(to.getTime() / 1000);
    const interval = tf === "1h" ? "60m" : tf;
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(fullTicker)}?period1=${period1}&period2=${period2}&interval=${interval}`;
    const res = await withRequestSlot(() =>
      fetch(url, { headers: { "User-Agent": "stock-market-backend/1.0" } })
    );
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const ts = r.timestamp ?? [];
    const q = r.indicators.quote[0];
    if (!q) throw new UpstreamPermanentError("yahoo: empty quote data");
    const out: Candle[] = [];
    if (q && q.open && q.high && q.low && q.close && q.volume && ts) {
      for (let i = 0; i < ts.length; i++) {
        const open = q.open[i];
        const high = q.high[i];
        const low = q.low[i];
        const close = q.close[i];
        const volume = q.volume[i];

        // Yahoo can include placeholder rows for future or incomplete sessions.
        // Those rows have null/zero OHLC values and must never reach charts or
        // strategy calculations as if they were real trades.
        if (
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close) ||
          open! <= 0 ||
          high! <= 0 ||
          low! <= 0 ||
          close! <= 0
        ) {
          continue;
        }

        out.push({
          symbol: fullTicker.replace(/\.(NS|BO)$/, ""),
          tf,
          ts: new Date(ts[i] * 1000).toISOString(),
          open: open!,
          high: high!,
          low: low!,
          close: close!,
          volume: Number.isFinite(volume) && volume! >= 0 ? volume! : 0,
        });
      }
    }

    // Write through to Redis cache (1 hour TTL)
    await setCachedJson(cacheKey, out, 3600);

    return out;
  });
}
