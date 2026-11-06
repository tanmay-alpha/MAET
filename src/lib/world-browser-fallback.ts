import type { SourceStatus, WorldEvent, WorldEventsResponse } from "@shared/world/contracts";
import { normalizeEonet, normalizeGdelt } from "@shared/world/normalize";
import { EONET_EVENTS_URL, gdeltQuery, gdeltUrl } from "@shared/world/upstreams";

/**
 * Render's egress cannot reach NASA EONET or GDELT, while both send
 * `Access-Control-Allow-Origin: *`. When the server reports one of them stale with nothing to
 * show, the page reads it directly and parses it with the server's own normaliser.
 */
export type BrowserFallbackSource = "NASA EONET" | "GDELT";

/** GDELT can take ~15 s to answer a browser; anything slower is treated as a failure. */
export const BROWSER_FETCH_TIMEOUT_MS = 25_000;

/**
 * One combined query instead of the server's six keeps the browser within GDELT's rate rule.
 * GDELT rejects the OR of every server term as too long, so each topic contributes its
 * broadest terms (eleven terms, 180 characters, answered with 50 articles when checked).
 */
export const BROWSER_GDELT_TERMS = [
  "sanctions",
  '"trade embargo"',
  "OPEC",
  '"oil supply"',
  "shipping",
  '"Red Sea"',
  '"Strait of Hormuz"',
  '"central bank"',
  '"interest rate"',
  '"export ban"',
  "war",
] as const;
export const BROWSER_GDELT_URL = gdeltUrl(gdeltQuery(BROWSER_GDELT_TERMS), 50);

export interface BrowserFetch {
  events: WorldEvent[];
  fetchedAt: string;
}

/** A source status as displayed, noting when the browser rather than the server fetched it. */
export interface DisplayedSource extends SourceStatus {
  browser?: "fetching" | "fetched";
}

export function needsBrowserFallback(
  response: WorldEventsResponse | undefined,
  source: BrowserFallbackSource,
): boolean {
  if (!response) return false;
  const status = response.sources.find((entry) => entry.source === source);
  return Boolean(status?.stale) && !response.events.some((event) => event.source === source);
}

export async function fetchFromBrowser(
  source: BrowserFallbackSource,
  signal: AbortSignal,
  dependencies: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<BrowserFetch> {
  const fetcher = dependencies.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = dependencies.now ?? Date.now;
  const response = await fetcher(source === "GDELT" ? BROWSER_GDELT_URL : EONET_EVENTS_URL, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(BROWSER_FETCH_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
  // GDELT answers rate-limit and query errors with plain text.
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`${source} returned invalid JSON`);
  }
  const fetchedAt = now();
  return {
    events: source === "GDELT" ? normalizeGdelt(payload) : normalizeEonet(payload, fetchedAt),
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

/** Server data with the browser's result substituted for a source the server could not read. */
export function applyBrowserFallback(
  response: WorldEventsResponse | undefined,
  source: BrowserFallbackSource,
  attempt: { data?: BrowserFetch; fetching: boolean },
): { events: WorldEvent[]; sources: DisplayedSource[] } {
  const events = response?.events ?? [];
  const sources: DisplayedSource[] = response?.sources ?? [];
  if (!needsBrowserFallback(response, source) || (!attempt.data && !attempt.fetching))
    return { events, sources };
  const { data } = attempt;
  return {
    events: data ? [...events, ...data.events] : events,
    sources: sources.map((status) => {
      if (status.source !== source) return status;
      return data
        ? { source, fetchedAt: data.fetchedAt, stale: false, browser: "fetched" }
        : { ...status, browser: "fetching" };
    }),
  };
}
