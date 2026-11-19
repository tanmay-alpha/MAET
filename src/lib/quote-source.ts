import { SYNTHETIC_QUOTE_LABEL } from "@/components/demo/demo-mode";

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
  yahoo_candles: "Yahoo candles",
  // Fundamentals on the company row (server/domain/screener/company-query.ts COMPANY_SNAPSHOT_SOURCE).
  company_snapshot: "Stored company snapshot",
};

const CLOSED_PHASES: Record<string, true> = { CLOSED: true, HOLIDAY: true, AFTER_HOURS: true };

/** Display name for an API `source` field ("angelone" → "Angel One"); unknown sources pass through. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

/** Provider name for a quote; a simulated (seeded demo or simulator) quote names no provider. */
export function quoteProviderName(source: string): string {
  return source === "simulated" ? SYNTHETIC_QUOTE_LABEL : sourceName(source);
}

/**
 * "Angel One · live", "Yahoo · delayed", "Yahoo · delayed · market closed": from the API's own
 * `source` field, so a label always states where that quote came from. Simulated quotes (the
 * seeded demo dataset and the market simulator) say they are synthetic; a real Yahoo quote in a
 * demo build still says Yahoo. The demo banner is the build-level signal.
 */
export function quoteSourceLabel(source: string, delayed: boolean, marketPhase?: string): string {
  if (source === "simulated") return SYNTHETIC_QUOTE_LABEL;
  const parts = [sourceName(source), delayed ? "delayed" : "live"];
  if (marketPhase && CLOSED_PHASES[marketPhase]) parts.push("market closed");
  return parts.join(" · ");
}

/** Hover text naming where a row's quote came from. */
export function quoteSourceTitle(quote: { source: string; delayed: boolean } | undefined): string {
  return quote ? `Quote source: ${quoteSourceLabel(quote.source, quote.delayed)}` : "Quote unavailable";
}
