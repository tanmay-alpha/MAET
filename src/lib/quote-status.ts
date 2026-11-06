import type { MarketQuote, MarketQuotesResponse } from "@/lib/market-api";

export type QuoteFeedState =
  | "loading"
  | "unavailable"
  | "empty"
  | "stale"
  | "closed"
  | "pre-open"
  | "delayed"
  | "unverified"
  | "live";

export interface QuoteFeed {
  state: QuoteFeedState;
  /** Requested symbols the response has a quote for. */
  quoted: number;
  /** Distinct symbols requested. */
  requested: number;
  /** Header text, e.g. "Delayed quotes · 48 of 50 symbols quoted". */
  label: string;
  /** Short badge text, e.g. "Delayed 48/50". */
  badge: string;
}

export interface QuoteFeedInput {
  /** Symbols the caller displays; matched case-insensitively. */
  requested: readonly string[];
  /** The latest quotes response, or undefined before the first one arrives. */
  response: MarketQuotesResponse | undefined;
  /** The latest quote request failed. */
  isError: boolean;
  now: Date;
}

// The closed label names the kind of close (see CLOSED_SESSIONS).
const TEXT: Record<Exclude<QuoteFeedState, "closed">, { label: string; badge: string }> = {
  loading: { label: "Loading quotes", badge: "Loading" },
  unavailable: { label: "Quote service unavailable", badge: "Unavailable" },
  empty: { label: "No quotes", badge: "No quotes" },
  stale: { label: "Stale quotes", badge: "Stale" },
  "pre-open": { label: "Pre-open · delayed quotes", badge: "Pre-open" },
  delayed: { label: "Delayed quotes", badge: "Delayed" },
  unverified: { label: "Quote freshness unverified", badge: "Unverified" },
  live: { label: "Live quotes", badge: "Live" },
};

const CLOSED_SESSIONS: Record<string, string> = {
  CLOSED: "Market closed",
  HOLIDAY: "Market closed · holiday",
  AFTER_HOURS: "Market closed · after hours",
};

// Asia/Kolkata is UTC+05:30 with no DST (server/domain/market/clock.ts). The client
// build may not import server modules, so the IST day is computed here.
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Days since the epoch on the IST calendar; NaN for an unparseable time. */
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/**
 * The server's own rule (server/domain/market/quote-quality.ts `sessionQuality`): a
 * broker print is live only if it is from today's IST session. Re-applied against the
 * browser clock so a response held in cache does not stay "live" into the next day.
 */
function isLiveQuote(quote: MarketQuote, today: number): boolean {
  if (quote.quality !== "live" || quote.delayed || quote.source !== "angelone") return false;
  return istDay(Date.parse(quote.ts)) === today;
}

function freshness(quotes: MarketQuote[], marketPhase: string | undefined, now: Date): QuoteFeedState {
  if (quotes.some((quote) => quote.quality === "stale")) return "stale";
  if (marketPhase && CLOSED_SESSIONS[marketPhase]) return "closed";
  if (marketPhase === "PRE_OPEN") return "pre-open";
  const today = istDay(now.getTime());
  if (!quotes.every((quote) => isLiveQuote(quote, today))) return "delayed";
  // Live also needs the session to be open; an unknown phase cannot confirm that.
  return marketPhase === "OPEN" ? "live" : "unverified";
}

/**
 * How fresh the displayed quotes are, from the quotes themselves. "Live" needs an open
 * session and every displayed quote to be a live-quality Angel One print from today;
 * a missing, empty, partial, stale or delayed response says so instead.
 */
export function quoteFeed({ requested, response, isError, now }: QuoteFeedInput): QuoteFeed {
  const symbols = new Set(requested.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const quotes = (response?.quotes ?? []).filter((quote) => symbols.has(quote.symbol.toUpperCase()));
  const quoted = new Set(quotes.map((quote) => quote.symbol.toUpperCase())).size;
  const result = (state: QuoteFeedState, suffix = { label: "", badge: "" }): QuoteFeed => {
    const text = state === "closed"
      ? { label: `${CLOSED_SESSIONS[response?.marketPhase ?? "CLOSED"]} · last available quotes`, badge: "Market closed" }
      : TEXT[state];
    return { state, quoted, requested: symbols.size, label: text.label + suffix.label, badge: text.badge + suffix.badge };
  };

  if (symbols.size === 0) return result("empty");
  if (isError) return result("unavailable", response ? { label: " · last quotes shown", badge: "" } : undefined);
  if (!response) return result("loading");
  if (quoted === 0) return result("empty");
  const partial = quoted < symbols.size
    ? { label: ` · ${quoted} of ${symbols.size} symbols quoted`, badge: ` ${quoted}/${symbols.size}` }
    : undefined;
  return result(freshness(quotes, response.marketPhase, now), partial);
}
