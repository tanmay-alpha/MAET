import type { MarketQuote, QuotesPayload, Tick } from "@shared/types";
import { getQuote } from "../../data/sources/yahoo";
import { bus } from "../../infra/bus";
import { getLogger } from "../../infra/logger";
import { quoteStore } from "./quote-store";
import { lookupSymbol, resolveMarketSymbol } from "./symbol";
import { getAngelOneMarketQuotes, type AngelOneMarketQuote } from "../../data/sources/angelone/client";
import { configuredHolidays, currentMarketPhase, sessionQuality, toMarketQuote } from "./quote-quality";

/** Upper bound on distinct symbols kept in the in-process quote cache. */
export const MAX_CACHED_QUOTES = 1_000;

function getCacheTtl(): number {
  const phase = currentMarketPhase();
  if (phase === "OPEN" || phase === "PRE_OPEN") {
    return 15_000; // 15 seconds during market hours
  }
  return 1800_000; // 30 minutes when market is closed/holiday
}

// Map iteration order is insertion order; re-inserting on write makes the
// first key the least recently refreshed one, which is evicted at capacity.
const cache = new Map<string, { tick: Tick; fetchedAt: number }>();
const inflight = new Map<string, Promise<Tick>>();

function rememberQuote(tick: Tick): void {
  cache.delete(tick.symbol);
  cache.set(tick.symbol, { tick, fetchedAt: Date.now() });
  if (cache.size > MAX_CACHED_QUOTES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export type QuoteLoadResult = {
  quotes: MarketQuote[];
  errors: Array<{ symbol: string; message: string }>;
};

/**
 * Latest quote for one symbol, with the same source order as loadQuotes():
 * a fresh live Angel One stream tick, then Angel One REST, then Yahoo.
 * Broker quotes are re-labelled on every read, so a quote cached as "live"
 * at 15:29 is "delayed" when served at 15:45.
 */
export async function loadQuote(symbol: string, force = false): Promise<Tick> {
  const [result] = await resolveQuotes([symbol.trim().toUpperCase()], force);
  if (result.status === "rejected") throw result.reason;
  const now = new Date();
  const quality = sessionQuality(result.value, now, currentMarketPhase(now));
  return quality === result.value.quality ? result.value : { ...result.value, quality };
}

/**
 * A broker tick already delivered by the WebSocket (or a REST snapshot) that
 * is live for the current session and younger than the cache TTL.
 */
function freshStreamTick(symbol: string, now: Date, ttl: number): Tick | undefined {
  const tick = quoteStore.get(symbol);
  if (!tick || tick.source !== "angelone") return undefined;
  if (sessionQuality(tick, now, currentMarketPhase(now)) !== "live") return undefined;
  return now.getTime() - Date.parse(tick.ts) < ttl ? tick : undefined;
}

/**
 * Source order shared by loadQuote/loadQuotes. `force` skips the stream tick
 * and the cache; a forced symbol that Angel One could not refresh goes to
 * Yahoo rather than back to the cache.
 */
async function resolveQuotes(symbols: string[], force: boolean): Promise<PromiseSettledResult<Tick>[]> {
  const now = new Date();
  const ttl = getCacheTtl();
  const streamed = new Map<string, Tick>();
  if (!force) {
    for (const symbol of symbols) {
      const tick = freshStreamTick(symbol, now, ttl);
      if (tick) streamed.set(symbol, tick);
    }
  }
  const needsRefresh = symbols.filter((symbol) => {
    if (streamed.has(symbol)) return false;
    const existing = cache.get(symbol);
    return force || !existing || now.getTime() - existing.fetchedAt >= ttl;
  });
  const refreshed = needsRefresh.length > 0 ? await refreshFromAngelOne(needsRefresh) : new Set<string>();

  return Promise.allSettled(
    symbols.map((symbol) => {
      const tick = streamed.get(symbol);
      return tick ? Promise.resolve(tick) : fetchQuote(symbol, force && !refreshed.has(symbol));
    })
  );
}

function fetchQuote(symbol: string, force: boolean): Promise<Tick> {
  const resolved = resolveMarketSymbol(symbol);
  const cached = cache.get(resolved.symbol);
  const ttl = getCacheTtl();
  if (!force && cached && Date.now() - cached.fetchedAt < ttl) return Promise.resolve(cached.tick);

  const existing = inflight.get(resolved.symbol);
  if (existing) return existing;

  const request = getQuote(resolved.symbol, resolved.ticker, resolved.exchange)
    .then((tick) => {
      rememberQuote(tick);
      quoteStore.set(tick);
      bus.emit("tick", tick);
      return tick;
    })
    .catch((error) => {
      if (cached) {
        const isStale = Date.now() - cached.fetchedAt >= ttl;
        return isStale ? { ...cached.tick, quality: "stale" as const } : cached.tick;
      }
      throw error;
    })
    .finally(() => {
      inflight.delete(resolved.symbol);
    });

  inflight.set(resolved.symbol, request);
  return request;
}

/** SmartAPI's market quote endpoint accepts at most 50 tokens per request. */
const ANGEL_QUOTE_BATCH_SIZE = 50;

/** Refreshes catalogued NSE symbols from Angel One REST; returns the symbols it refreshed. */
async function refreshFromAngelOne(symbols: string[]): Promise<Set<string>> {
  const refreshed = new Set<string>();
  const requests = symbols.flatMap((symbol) => {
    const record = lookupSymbol("NSE", symbol);
    return record ? [{ symbol, token: record.token }] : [];
  });
  const batches: Array<typeof requests> = [];
  for (let start = 0; start < requests.length; start += ANGEL_QUOTE_BATCH_SIZE) {
    batches.push(requests.slice(start, start + ANGEL_QUOTE_BATCH_SIZE));
  }
  let snapshots: AngelOneMarketQuote[];
  try {
    snapshots = (await Promise.all(batches.map((batch) => getAngelOneMarketQuotes(batch)))).flat();
  } catch (error) {
    // Yahoo below remains the delayed fallback, but the switch must be visible.
    try {
      getLogger().warn(
        { err: error instanceof Error ? error.message : String(error), symbols: requests.length },
        "angel one REST quotes failed; falling back to Yahoo"
      );
    } catch {
      // Logger unavailable (invalid env); the fallback itself must still work.
    }
    return refreshed;
  }

  const now = new Date();
  const phase = currentMarketPhase(now);
  for (const snapshot of snapshots) {
    const tick: Tick = {
      exchange: "NSE",
      symbol: snapshot.symbol,
      price: snapshot.price,
      volume: snapshot.volume,
      ts: snapshot.ts,
      source: "angelone",
      quality: sessionQuality({ quality: "live", ts: snapshot.ts }, now, phase),
      previousClose: snapshot.previousClose,
      change: snapshot.change,
      changePct: snapshot.changePct,
      currency: "INR",
    };
    rememberQuote(tick);
    quoteStore.set(tick);
    bus.emit("tick", tick);
    refreshed.add(tick.symbol);
  }
  return refreshed;
}

export async function loadQuotes(symbols: string[], force = false): Promise<QuoteLoadResult> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const settled = await resolveQuotes(unique, force);
  const now = new Date();
  const phase = currentMarketPhase(now);
  const quotes: MarketQuote[] = [];
  const errors: QuoteLoadResult["errors"] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") quotes.push(toMarketQuote(result.value, now, phase));
    else errors.push({ symbol: unique[index], message: String(result.reason) });
  });

  return { quotes, errors };
}

/** Response body shared by GET /api/market/quotes and the SSE snapshot event. */
export function buildQuotesPayload(
  result: QuoteLoadResult,
  now: Date = new Date(),
  holidays: Date[] = configuredHolidays()
): QuotesPayload {
  return {
    asOf: now.toISOString(),
    source: result.quotes.some((quote) => quote.source === "angelone") ? "angelone" : "yahoo",
    delayed: result.quotes.some((quote) => quote.delayed),
    marketPhase: currentMarketPhase(now, holidays),
    quotes: result.quotes,
    errors: result.errors,
  };
}
