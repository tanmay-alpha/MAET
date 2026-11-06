import type { MarketQuote, MarketQuotesResponse } from "@/lib/market-api";
import { quoteFeed } from "@/lib/quote-status";

/** Fixed buckets keep the same percentage the same colour across refreshes. */
export function heatmapTone(changePct: number | undefined): string {
  if (changePct === undefined || !Number.isFinite(changePct)) return "bg-panel text-muted-foreground";
  if (changePct <= -2) return "bg-[#9f3540] text-white";
  if (changePct < -0.5) return "bg-[#70313c] text-white";
  if (changePct < 0) return "bg-[#422b35] text-[#f5bbc0]";
  if (changePct === 0) return "bg-panel-elevated text-foreground";
  if (changePct < 0.5) return "bg-[#203d39] text-[#ace0cf]";
  if (changePct < 2) return "bg-[#235c50] text-white";
  return "bg-[#287b66] text-white";
}

export function formatChange(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

export function sourceName(source: string): string {
  return ({ angelone: "Angel One", yahoo: "Yahoo Finance" } as Record<string, string>)[source] ?? source;
}

export function quoteTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Source and freshness of a response; the symbols it covers are its quotes plus its per-symbol errors. */
export function marketSummary(data: MarketQuotesResponse, now: Date = new Date()): string {
  const requested = [...data.quotes, ...data.errors].map((entry) => entry.symbol);
  const status = quoteFeed({ requested, response: data, isError: false, now }).label;
  // With no quotes there is no source to credit.
  if (!data.quotes.length) return status;
  return `${[...new Set(data.quotes.map((quote) => quote.source))].map(sourceName).join(" + ")} · ${status}`;
}

export function quoteRange(quotes: MarketQuote[]): string | undefined {
  if (!quotes.length) return undefined;
  const timestamps = quotes.map((quote) => Date.parse(quote.ts));
  const first = quoteTime(new Date(Math.min(...timestamps)).toISOString());
  const last = quoteTime(new Date(Math.max(...timestamps)).toISOString());
  return first === last ? `${first} IST` : `${first} – ${last} IST`;
}
