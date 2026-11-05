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
 * Latest quote for one symbol. Cached broker quotes are re-labelled on every
 * read, so a quote cached as "live" at 15:29 is "delayed" when served at 15:45.
 */
export async function loadQuote(symbol: string, force = false): Promise<Tick> {
  const tick = await fetchQuote(symbol, force);
  const now = new Date();
  const quality = sessionQuality(tick, now, currentMarketPhase(now));
  return quality === tick.quality ? tick : { ...tick, quality };
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

async function refreshFromAngelOne(symbols: string[]): Promise<void> {
  const requests = symbols.flatMap((symbol) => {
    const record = lookupSymbol("NSE", symbol);
    return record ? [{ symbol, token: record.token }] : [];
  });
  let snapshots: AngelOneMarketQuote[];
  try {
    snapshots = await getAngelOneMarketQuotes(requests);
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
    return;
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
  }
}

export async function loadQuotes(symbols: string[], force = false): Promise<QuoteLoadResult> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const ttl = getCacheTtl();
  const missing = unique.filter((symbol) => {
    const existing = cache.get(symbol);
    return force || !existing || Date.now() - existing.fetchedAt >= ttl;
  });
  if (missing.length > 0) await refreshFromAngelOne(missing);

  const settled = await Promise.allSettled(unique.map((symbol) => fetchQuote(symbol, false)));
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
