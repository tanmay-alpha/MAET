import type { Tick } from "@shared/types";
import { getQuote } from "../../data/sources/yahoo";
import { bus } from "../../infra/bus";
import { quoteStore } from "./quote-store";
import { lookupSymbol, resolveMarketSymbol } from "./symbol";
import { getAngelOneMarketQuotes } from "../../data/sources/angelone/client";
import { computePhase } from "./clock";
import { getConfig } from "../../config";

function getCacheTtl(): number {
  try {
    const holidays = getConfig().nseHolidays;
    const phase = computePhase(new Date(), holidays);
    if (phase === "OPEN" || phase === "PRE_OPEN") {
      return 15_000; // 15 seconds during market hours
    }
    return 1800_000; // 30 minutes when market is closed/holiday
  } catch {
    return 15_000; // fallback to 15s
  }
}
const cache = new Map<string, { tick: Tick; fetchedAt: number }>();
const inflight = new Map<string, Promise<Tick>>();

export type QuoteLoadResult = {
  quotes: Tick[];
  errors: Array<{ symbol: string; message: string }>;
};

export async function loadQuote(symbol: string, force = false): Promise<Tick> {
  const resolved = resolveMarketSymbol(symbol);
  const cached = cache.get(resolved.symbol);
  const ttl = getCacheTtl();
  if (!force && cached && Date.now() - cached.fetchedAt < ttl) return cached.tick;

  const existing = inflight.get(resolved.symbol);
  if (existing) return existing;

  const request = getQuote(resolved.symbol, resolved.ticker, resolved.exchange)
    .then((tick) => {
      cache.set(resolved.symbol, { tick, fetchedAt: Date.now() });
      quoteStore.set(tick);
      bus.emit("tick", tick);
      return tick;
    })
    .catch((error) => {
      if (cached) return cached.tick;
      throw error;
    })
    .finally(() => {
      inflight.delete(resolved.symbol);
    });

  inflight.set(resolved.symbol, request);
  return request;
}

export async function loadQuotes(symbols: string[], force = false): Promise<QuoteLoadResult> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const ttl = getCacheTtl();
  const missing = unique.filter((symbol) => {
    const existing = cache.get(symbol);
    return force || !existing || Date.now() - existing.fetchedAt >= ttl;
  });
  if (missing.length > 0) {
    try {
      const requests = missing.flatMap((symbol) => {
        const record = lookupSymbol("NSE", symbol);
        return record ? [{ symbol, token: record.token }] : [];
      });
      const snapshots = await getAngelOneMarketQuotes(requests);
      for (const snapshot of snapshots) {
        const tick: Tick = {
          exchange: "NSE",
          symbol: snapshot.symbol,
          price: snapshot.price,
          volume: snapshot.volume,
          ts: new Date().toISOString(),
          source: "angelone",
          previousClose: snapshot.previousClose,
          change: snapshot.change,
          changePct: snapshot.changePct,
          currency: "INR",
        };
        cache.set(tick.symbol, { tick, fetchedAt: Date.now() });
        quoteStore.set(tick);
        bus.emit("tick", tick);
      }
    } catch {
      // Yahoo below remains the delayed fallback when broker REST is unavailable.
    }
  }
  const settled = await Promise.allSettled(unique.map((symbol) => loadQuote(symbol, false)));
  const quotes: Tick[] = [];
  const errors: QuoteLoadResult["errors"] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") quotes.push(result.value);
    else errors.push({ symbol: unique[index], message: String(result.reason) });
  });

  return { quotes, errors };
}
