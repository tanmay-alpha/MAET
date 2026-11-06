/** Upstream endpoints read by both the server cache and the browser fallback. */

export const EONET_EVENTS_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7";

/** GDELT asks every client for at most one request every five seconds. */
export const GDELT_SPACING_MS = 5_000;

/** Market-relevant GDELT DOC terms, one group per server query; phrases keep their quotes. */
export const GDELT_TOPICS = [
  ["sanctions", '"trade embargo"'],
  ["OPEC", '"oil supply"', '"oil production"'],
  ["shipping", '"Red Sea"', '"Strait of Hormuz"', '"Taiwan Strait"'],
  ['"rate decision"', '"interest rate"', '"central bank"'],
  ['"export ban"', '"export restrictions"'],
  ["conflict", "war", '"military escalation"'],
] as const satisfies readonly (readonly string[])[];

export function gdeltQuery(terms: readonly string[]): string {
  return `(${terms.join(" OR ")}) sourcelang:english`;
}

export function gdeltUrl(query: string, maxRecords: number): string {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxRecords),
    timespan: "24h",
    sort: "datedesc",
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
}
