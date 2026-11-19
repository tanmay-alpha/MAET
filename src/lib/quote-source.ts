import { SYNTHETIC_QUOTE_LABEL, isDemoBuild } from "@/components/demo/demo-mode";

const SOURCE_NAMES: Record<string, string> = {
  angelone: "Angel One",
  yahoo: "Yahoo",
  nse: "NSE",
  database: "Stored snapshot",
  // The market simulator and the synthetic demo dataset (quality "synthetic").
  simulated: "Simulated",
  // Fundamentals / statements providers (server/data/sources/yahoo-fundamentals.ts)
  yahoo_timeseries: "Yahoo Finance · time series",
  yahoo_quote_summary: "Yahoo Finance · quote summary",
};

const CLOSED_PHASES: Record<string, true> = { CLOSED: true, HOLIDAY: true, AFTER_HOURS: true };

/** Display name for an API `source` field ("angelone" → "Angel One"); unknown sources pass through. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

/** Provider name for a quote; a demo build names no provider, its quotes are generated. */
export function quoteProviderName(source: string): string {
  return isDemoBuild() ? SYNTHETIC_QUOTE_LABEL : sourceName(source);
}

/**
 * "Angel One · live", "Yahoo · delayed", "Yahoo · delayed · market closed": from the API's own
 * `source` field. Simulated quotes say "synthetic", and a demo build (VITE_MAET_DEMO_MODE=1)
 * labels every quote synthetic: its data is generated, whatever provider name a response carries.
 */
export function quoteSourceLabel(source: string, delayed: boolean, marketPhase?: string): string {
  if (isDemoBuild()) return SYNTHETIC_QUOTE_LABEL;
  const parts = [sourceName(source), source === "simulated" ? "synthetic" : delayed ? "delayed" : "live"];
  if (marketPhase && CLOSED_PHASES[marketPhase]) parts.push("market closed");
  return parts.join(" · ");
}

/** Hover text naming where a row's quote came from; demo builds call it synthetic. */
export function quoteSourceTitle(quote: { source: string; delayed: boolean } | undefined): string {
  return quote ? `Quote source: ${quoteSourceLabel(quote.source, quote.delayed)}` : "Quote unavailable";
}
