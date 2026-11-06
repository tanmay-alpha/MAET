import type { Candle, CorporateActionEvent, Tick } from "../../../shared/types";
import { UpstreamDegradedError, UpstreamPermanentError } from "../../../shared/types";
import { getConfig } from "../../config";
import { getCachedJson, setCachedJson } from "../../data/redis/client";
import { RedisKeys } from "../../data/redis/keys";

// Upstream error classes live in shared/types/errors.ts so that all data/sources/*
// modules can depend on them without coupling to a specific source (yahoo, nse, ...).
// Per spec section 4, data/* may import from shared/ and infra/ but not from sibling data/*.

export { UpstreamDegradedError, UpstreamPermanentError };

const HOST = "query1.finance.yahoo.com";
const MAX_CONCURRENT_REQUESTS = 4;
// Yahoo throttles (429) non-browser agents from datacenter IPs; quotes and
// candles must present the same browser identity.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Candle cache freshness per timeframe: an intraday chart must not be served
// an hour-old snapshot. The request window is aligned to this granularity so
// repeated requests within one window share a cache entry.
const CANDLE_CACHE_SECONDS: Record<Candle["tf"], number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 1800,
  "1d": 3600,
  "1wk": 3600,
};

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
        marketState?: string;
        currency?: string;
        regularMarketTime?: number;
        gmtoffset?: number;
        /** Decimals Yahoo publishes prices with (2 for NSE/BSE). */
        priceHint?: number;
      };
      timestamp?: number[];
      events?: YahooChartEvents;
      indicators?: {
        quote: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: unknown;
  };
};

/** `events=div,splits` payload of the v8 chart API, keyed by an opaque timestamp. */
export type YahooChartEvents = {
  dividends?: Record<string, { amount?: number; date?: number; currency?: string }>;
  splits?: Record<string, { date?: number; numerator?: number; denominator?: number; splitRatio?: string }>;
};

const IST_OFFSET_SECONDS = 19_800;
const SPLIT_RATIO = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/;

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Exchange-local calendar date of a provider timestamp (seconds). */
function exchangeDate(seconds: number, gmtOffsetSeconds: number): string {
  return new Date((seconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

/** Exchange-local date of the Monday that starts the week containing `seconds`. */
function exchangeWeek(seconds: number, gmtOffsetSeconds: number): string {
  const local = new Date((seconds + gmtOffsetSeconds) * 1000);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(local.getTime() - daysSinceMonday * 86_400_000).toISOString().slice(0, 10);
}

/** Yahoo stores OHLC as float32 (24536.599609375); it publishes `priceHint` decimals (24536.6). */
function publishedPrice(value: number, priceHint: number | undefined): number {
  const decimals = typeof priceHint === "number" && Number.isInteger(priceHint) && priceHint >= 0 ? priceHint : 2;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

type YahooChartResult = NonNullable<YahooChartResp["chart"]["result"]>[number];

/**
 * Close of the session before the quote's session: the latest daily bar with a
 * close, dated strictly before the exchange date of `regularMarketTime`.
 *
 * Yahoo's `chartPreviousClose`/`previousClose` are not used. Yahoo leaves the
 * latest session's daily close empty until well into the next day, and for
 * indices those fields then skip a session: on 2026-11-07 they were 23960.6
 * for ^NSEI (4 Nov's close) while NSE published 24536.6 (5 Nov's close) as
 * the previous close of the 6 Nov session.
 */
function previousSessionClose(result: YahooChartResult): number | undefined {
  const { meta } = result;
  if (!positive(meta.regularMarketTime)) return undefined;
  const offset = meta.gmtoffset ?? IST_OFFSET_SECONDS;
  const session = exchangeDate(meta.regularMarketTime, offset);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote[0]?.close ?? [];
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const close = closes[i];
    if (positive(close) && exchangeDate(timestamps[i], offset) < session) return publishedPrice(close, meta.priceHint);
  }
  return undefined;
}

/** NSE trading holidays from the server configuration; none when it cannot load. */
function configuredHolidays(): Date[] {
  try {
    return getConfig().nseHolidays;
  } catch {
    return [];
  }
}

/**
 * OHLCV bars of a Yahoo chart response. Rows without a positive open, high and
 * low (placeholders for future or empty sessions) are dropped. Three Yahoo
 * quirks on NSE data are corrected:
 *
 * - The daily (or weekly) bar of the quote's own session keeps a null close
 *   until well into the next day. That bar closes at `regularMarketPrice`, the
 *   price the quote shows, so the chart does not end a session before the
 *   quote. It is replaced by Yahoo's final bar once the candle cache expires.
 * - The current week arrives as the Monday bar (completed sessions) plus a
 *   partial bar stamped at the last trade time. The two are merged into the
 *   Monday bar: its open, the combined range and volume, the latest close.
 * - A flat, zero-volume daily bar dated on an NSE holiday is not a session and
 *   is dropped. A real trading session on a holiday (Muhurat) keeps its bar.
 */
function normalizeYahooCandles(
  result: YahooChartResult,
  tf: Candle["tf"],
  symbol: string,
  holidays: Date[]
): Candle[] {
  const { meta } = result;
  const quote = result.indicators?.quote[0];
  const timestamps = result.timestamp ?? [];
  if (!quote?.open || !quote.high || !quote.low || !quote.close || !quote.volume) return [];
  const offset = meta.gmtoffset ?? IST_OFFSET_SECONDS;
  const periodOf =
    tf === "1d" ? (seconds: number) => exchangeDate(seconds, offset)
    : tf === "1wk" ? (seconds: number) => exchangeWeek(seconds, offset)
    : undefined;
  const livePrice = meta.regularMarketPrice;
  const livePeriod =
    periodOf && positive(meta.regularMarketTime) && positive(livePrice) ? periodOf(meta.regularMarketTime) : undefined;
  const holidayDates = new Set(
    tf === "1d" ? holidays.map((holiday) => exchangeDate(holiday.getTime() / 1000, IST_OFFSET_SECONDS)) : []
  );

  const out: Candle[] = [];
  let lastPeriod: string | undefined;
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open[i];
    let high = quote.high[i];
    let low = quote.low[i];
    let close = quote.close[i];
    if (!positive(open) || !positive(high) || !positive(low)) continue;
    const period = periodOf?.(timestamps[i]);
    if (!positive(close)) {
      if (period === undefined || period !== livePeriod) continue;
      close = livePrice;
      high = Math.max(high, close);
      low = Math.min(low, close);
    }
    const rawVolume = quote.volume[i];
    const volume = typeof rawVolume === "number" && Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume : 0;
    if (period !== undefined && holidayDates.has(period) && open === high && high === low && low === close && volume === 0) {
      continue;
    }

    const previous = out.at(-1);
    if (tf === "1wk" && previous && period === lastPeriod) {
      out[out.length - 1] = {
        ...previous,
        high: Math.max(previous.high, high),
        low: Math.min(previous.low, low),
        close,
        volume: previous.volume + volume,
      };
      continue;
    }
    out.push({ symbol, tf, ts: new Date(timestamps[i] * 1000).toISOString(), open, high, low, close, volume });
    lastPeriod = period;
  }
  return out;
}

/** numerator:denominator from Yahoo's numeric fields, else from its "2:1" string. */
function splitRatio(split: NonNullable<YahooChartEvents["splits"]>[string]): [number, number] | null {
  if (positive(split.numerator) && positive(split.denominator)) return [split.numerator, split.denominator];
  const match = split.splitRatio ? SPLIT_RATIO.exec(split.splitRatio) : null;
  if (!match) return null;
  const ratio: [number, number] = [Number(match[1]), Number(match[2])];
  return positive(ratio[0]) && positive(ratio[1]) ? ratio : null;
}

/**
 * Dividends and splits from a Yahoo chart response, newest first (same-day
 * dividends before splits), without duplicates or malformed rows. Nothing is
 * inferred: a dividend without a currency or a 1:1 "split" is dropped.
 */
export function normalizeYahooCorporateActions(
  events: YahooChartEvents | undefined,
  meta: { currency?: string; gmtoffset?: number } = {}
): CorporateActionEvent[] {
  const offset = Number.isFinite(meta.gmtoffset) ? meta.gmtoffset! : IST_OFFSET_SECONDS;
  const seen = new Set<string>();
  const splits: Array<Extract<CorporateActionEvent, { kind: "split" }>> = [];
  for (const split of Object.values(events?.splits ?? {})) {
    const ratio = splitRatio(split);
    if (!positive(split.date) || !ratio || ratio[0] === ratio[1]) continue;
    const exDate = exchangeDate(split.date, offset);
    const key = `split:${exDate}:${ratio[0]}:${ratio[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    splits.push({ kind: "split", exDate, numerator: ratio[0], denominator: ratio[1] });
  }

  const dividends: Array<Extract<CorporateActionEvent, { kind: "dividend" }>> = [];
  for (const dividend of Object.values(events?.dividends ?? {})) {
    const currency = dividend.currency ?? meta.currency;
    if (!positive(dividend.date) || !positive(dividend.amount) || !currency) continue;
    const exDate = exchangeDate(dividend.date, offset);
    const key = `dividend:${exDate}:${dividend.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dividends.push({
      kind: "dividend",
      exDate,
      amount: dividend.amount,
      currency,
      // Yahoo restates a dividend for every later split or bonus.
      splitAdjusted: splits.some((split) => split.exDate > exDate),
    });
  }

  return [...dividends, ...splits].sort((a, b) => {
    if (a.exDate !== b.exDate) return a.exDate < b.exDate ? 1 : -1;
    return a.kind === b.kind ? 0 : a.kind === "dividend" ? -1 : 1;
  });
}

/** Every dividend and split Yahoo reports for a ticker, over its full history. */
export async function getCorporateActions(ticker: string): Promise<CorporateActionEvent[]> {
  const fullTicker = symbolToTicker(ticker);
  return withRetry(async () => {
    // Monthly bars keep the full-history response small; events carry their own dates.
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(fullTicker)}?range=max&interval=1mo&events=div%2Csplits`;
    const res = await withRequestSlot(() => fetch(url, { headers: { "User-Agent": BROWSER_USER_AGENT } }));
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo events ${res.status} for ${fullTicker}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo events ${res.status} for ${fullTicker}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    return normalizeYahooCorporateActions(r.events, r.meta);
  });
}

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
    // Daily bars: the quote itself is in `meta`, the bars give the previous
    // session's close (see previousSessionClose). A month spans any holiday run.
    const url = `https://${HOST}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
    const res = await withRequestSlot(() =>
      fetch(url, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
      })
    );
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo ${res.status}`);
    if (res.status === 404) throw new UpstreamPermanentError(`symbol not found: ${ticker}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo ${res.status}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    const providerTimestamp = r.meta.regularMarketTime;
    if (
      typeof providerTimestamp !== "number" ||
      !Number.isFinite(providerTimestamp) ||
      providerTimestamp <= 0
    ) {
      throw new UpstreamPermanentError(
        "yahoo: missing provider quote timestamp"
      );
    }
    const exchange = exchangeOverride ?? (ticker.endsWith(".BO") ? "BSE" : "NSE");
    const previousClose = previousSessionClose(r);
    const change =
      previousClose !== undefined ? publishedPrice(r.meta.regularMarketPrice - previousClose, r.meta.priceHint) : undefined;
    return {
      exchange,
      symbol: symbol.replace(/\.(NS|BO)$/, ""),
      price: r.meta.regularMarketPrice,
      volume: r.meta.regularMarketVolume,
      ts: new Date(
        providerTimestamp * 1000
      ).toISOString(),
      source: "yahoo",
      quality: "delayed",
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
  tf: Candle["tf"],
  holidays: Date[] = configuredHolidays()
): Promise<Candle[]> {
  // --- Redis cache lookup ---
  const cacheSeconds = CANDLE_CACHE_SECONDS[tf];
  const cacheKey = RedisKeys.candlesKey("NSE", ticker, tf,
    Math.floor(from.getTime() / 1000 / cacheSeconds).toString(),
    Math.floor(to.getTime() / 1000 / cacheSeconds).toString(),
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
      fetch(url, { headers: { "User-Agent": BROWSER_USER_AGENT } })
    );
    if (res.status === 429 || res.status >= 500) throw new UpstreamDegradedError(`yahoo candles ${res.status} for ${fullTicker}`);
    if (!res.ok) throw new UpstreamPermanentError(`yahoo candles ${res.status} for ${fullTicker}`);
    const data = (await res.json()) as YahooChartResp;
    const r = data.chart.result?.[0];
    if (!r) throw new UpstreamPermanentError("yahoo: empty result");
    if (!r.indicators?.quote[0]) throw new UpstreamPermanentError("yahoo: empty quote data");
    const out = normalizeYahooCandles(r, tf, fullTicker.replace(/\.(NS|BO)$/, ""), holidays);

    await setCachedJson(cacheKey, out, cacheSeconds);

    return out;
  });
}
