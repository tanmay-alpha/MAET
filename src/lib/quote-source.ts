const SOURCE_NAMES: Record<string, string> = {
  angelone: "Angel One",
  yahoo: "Yahoo",
  nse: "NSE",
  database: "Stored snapshot",
};

const CLOSED_PHASES: Record<string, true> = { CLOSED: true, HOLIDAY: true, AFTER_HOURS: true };

/** Display name for an API `source` field ("angelone" → "Angel One"); unknown sources pass through. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

/** "Angel One · live", "Yahoo · delayed", "Yahoo · delayed · market closed": from the API's own `source` field. */
export function quoteSourceLabel(source: string, delayed: boolean, marketPhase?: string): string {
  const parts = [sourceName(source), delayed ? "delayed" : "live"];
  if (marketPhase && CLOSED_PHASES[marketPhase]) parts.push("market closed");
  return parts.join(" · ");
}
