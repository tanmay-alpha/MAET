import type { Tick } from "@shared/types";
import { getQuote } from "../../data/sources/yahoo";
import { bus } from "../../infra/bus";
import { quoteStore } from "./quote-store";
import { resolveMarketSymbol } from "./symbol";

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { tick: Tick; fetchedAt: number }>();
const inflight = new Map<string, Promise<Tick>>();

export type QuoteLoadResult = {
  quotes: Tick[];
  errors: Array<{ symbol: string; message: string }>;
};

export async function loadQuote(symbol: string, force = false): Promise<Tick> {
  const resolved = resolveMarketSymbol(symbol);
  const cached = cache.get(resolved.symbol);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.tick;

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
  const settled = await Promise.allSettled(unique.map((symbol) => loadQuote(symbol, force)));
  const quotes: Tick[] = [];
  const errors: QuoteLoadResult["errors"] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") quotes.push(result.value);
    else errors.push({ symbol: unique[index], message: String(result.reason) });
  });

  return { quotes, errors };
}
