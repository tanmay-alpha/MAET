import type { SourceStatus, WorldEvent, WorldEventsResponse } from "@shared/world/contracts";
import { WORLD_FRESHNESS } from "@shared/world/freshness";
import { normalizeEonet, normalizeGdelt } from "@shared/world/normalize";
import { EONET_EVENTS_URL, GDELT_SPACING_MS, gdeltQuery, gdeltUrl } from "@shared/world/upstreams";

/**
 * Render's egress cannot reach NASA EONET or GDELT, while both send
 * `Access-Control-Allow-Origin: *`. When the server reports one of them stale with nothing to
 * show, the page reads it directly and parses it with the server's own normaliser.
 */
export type BrowserFallbackSource = "NASA EONET" | "GDELT";

/** GDELT can take ~15 s to answer a browser; anything slower is treated as a failure. */
export const BROWSER_FETCH_TIMEOUT_MS = 25_000;

/** Browser data nobody is looking at is discarded after this, well inside every source's max age. */
export const BROWSER_FALLBACK_GC_MS = 30 * 60_000;

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

/** The browser query's state as the page sees it. */
export interface BrowserAttempt {
  data?: BrowserFetch;
  /** Set while the latest attempt has failed; `data` then still holds the last success. */
  error?: Error | null;
  fetching: boolean;
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

/**
 * React Query timing for a source's browser query, matching the server cache: data is current
 * for the source's TTL, an open page and a revisit after it revalidate once, and an unobserved
 * result is dropped after BROWSER_FALLBACK_GC_MS. Focus never refetches, so a failing source is
 * asked again only on that schedule, on a revisit or on Retry. GDELT answers one request per five
 * seconds, so a revisit that soon after its last attempt waits for the interval or Retry.
 */
export function browserQueryPolicy(
  source: BrowserFallbackSource,
  lastSettledAt: number,
  now: number,
) {
  const { ttlMs } = WORLD_FRESHNESS[source];
  const mayAsk = source !== "GDELT" || now - lastSettledAt >= GDELT_SPACING_MS;
  return {
    staleTime: ttlMs,
    refetchInterval: ttlMs,
    gcTime: BROWSER_FALLBACK_GC_MS,
    refetchOnMount: mayAsk,
    retryOnMount: mayAsk,
    refetchOnWindowFocus: false,
  };
}

/** When browser data reaches its source's max age and stops being shown. */
export function browserDataExpiresAt(source: BrowserFallbackSource, data: BrowserFetch): number {
  return Date.parse(data.fetchedAt) + WORLD_FRESHNESS[source].maxAgeMs;
}

/**
 * Server data with the browser's result substituted for a source the server could not read.
 * Browser data from before a failed revalidation stays, marked stale with that failure; once it
 * reaches the source's max age at `now` it is dropped and the server's own status shows again.
 */
export function applyBrowserFallback(
  response: WorldEventsResponse | undefined,
  source: BrowserFallbackSource,
  attempt: BrowserAttempt,
  now: number,
): { events: WorldEvent[]; sources: DisplayedSource[] } {
  const events = response?.events ?? [];
  const sources: DisplayedSource[] = response?.sources ?? [];
  const data =
    attempt.data && now < browserDataExpiresAt(source, attempt.data) ? attempt.data : undefined;
  if (!needsBrowserFallback(response, source) || (!data && !attempt.fetching))
    return { events, sources };
  const { error } = attempt;
  return {
    events: data ? [...events, ...data.events] : events,
    sources: sources.map((status): DisplayedSource => {
      if (status.source !== source) return status;
      if (!data) return { ...status, browser: "fetching" };
      return error
        ? { source, fetchedAt: data.fetchedAt, stale: true, error: error.message, browser: "fetched" }
        : { source, fetchedAt: data.fetchedAt, stale: false, browser: "fetched" };
    }),
  };
}
