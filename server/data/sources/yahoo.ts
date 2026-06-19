import { getLogger } from "../../infra/logger";
import type { Candle, Tick } from "@shared/types";
import { UpstreamDegradedError, UpstreamPermanentError } from "@shared/types/errors";

// Upstream error classes live in shared/types/errors.ts so that all data/sources/*
// modules can depend on them without coupling to a specific source (yahoo, nse, ...).
// Per spec section 4, data/* may import from shared/ and infra/ but not from sibling data/*.

export { UpstreamDegradedError, UpstreamPermanentError };

const log = getLogger().child({ source: "yahoo" });

const HOST = "query1.finance.yahoo.com";
const FAIL_WINDOW_MS = 60_000;
const FAIL_THRESHOLD = 3;
const OPEN_MS = 5 * 60_000;

let fails: number[] = [];
let openedAt = 0;

export function _resetCircuitForTest(): void {
  fails = [];
  openedAt = 0;
}

function noteFail(): void {
  const now = Date.now();
  fails = fails.filter((t) => now - t < FAIL_WINDOW_MS);
  fails.push(now);
  if (fails.length >= FAIL_THRESHOLD) openedAt = now;
}

function noteSuccess(): void {
  fails = [];
  openedAt = 0;
}

function isOpen(): boolean {
  if (!openedAt) return false;
  if (Date.now() - openedAt > OPEN_MS) {
    openedAt = 0;
    fails = [];
    return false;
  }
  return true;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const tries = 3;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    if (isOpen()) throw new UpstreamDegradedError("yahoo circuit open");
    try {
      const r = await fn();
      noteSuccess();
      return r;
    } catch (e) {
      lastErr = e;
      noteFail();
      const wait = 200 * Math.pow(2, i) + Math.floor(Math.random() * 100);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

type YahooChartResp = {
  chart: {
    result?: Array<{
      meta: { regularMarketPrice: number; regularMarketVolume: number; symbol: string };
      timestamp?: number[];
      indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> };
    }>;
    error?: unknown;
  };
};

function symbolToTicker(symbol: string): string {
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) return symbol;
  return `${symbol}.NS`;
}

export async function getQuote(symbol: string): Promise<Tick> {
  const ticker = symbolToTicker(symbol);
  return withRetry(async () => {
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "stock-market-backend/1.0" } });
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (res.status === 404) throw new UpstreamPermanentError(`symbol not found: ${ticker}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const exchange = ticker.endsWith(".NS") ? "NSE" : "BSE";
    return {
      exchange,
      symbol: ticker.replace(/\.(NS|BO)$/, ""),
      price: r.meta.regularMarketPrice,
      volume: r.meta.regularMarketVolume,
      ts: new Date().toISOString(),
      source: "yahoo",
    } satisfies Tick;
  });
}

export async function getCandles(
  ticker: string,
  from: Date,
  to: Date,
  tf: "1m" | "1d"
): Promise<Candle[]> {
  return withRetry(async () => {
    const fullTicker = symbolToTicker(ticker);
    const period1 = Math.floor(from.getTime() / 1000);
    const period2 = Math.floor(to.getTime() / 1000);
    const interval = tf === "1m" ? "1m" : "1d";
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(fullTicker)}?period1=${period1}&period2=${period2}&interval=${interval}`;
    const res = await fetch(url, { headers: { "User-Agent": "stock-market-backend/1.0" } });
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const ts = r.timestamp ?? [];
    const q = r.indicators.quote[0];
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      out.push({
        symbol: fullTicker.replace(/\.(NS|BO)$/, ""),
        tf,
        ts: new Date(ts[i] * 1000).toISOString(),
        open: q.open[i] ?? 0,
        high: q.high[i] ?? 0,
        low: q.low[i] ?? 0,
        close: q.close[i] ?? 0,
        volume: q.volume[i] ?? 0,
      });
    }
    return out;
  });
}
