import { describe, expect, it } from "bun:test";
import type { MarketQuote, MarketQuotesResponse } from "@/lib/market-api";
import { quoteFeed, type QuoteFeedState } from "./quote-status";

// 10:30 IST on Friday 6 Nov 2026, inside the cash session.
const NOW = new Date("2026-11-06T05:00:00.000Z");
const TODAY = "2026-11-06T04:59:58.000Z";
const YESTERDAY = "2026-11-05T09:59:00.000Z";

const quote = (symbol: string, overrides: Partial<MarketQuote> = {}): MarketQuote => ({
  symbol, exchange: "NSE", price: 100, ts: TODAY, source: "angelone", quality: "live", delayed: false, ...overrides,
});
const response = (quotes: MarketQuote[], overrides: Partial<MarketQuotesResponse> = {}): MarketQuotesResponse => ({
  asOf: NOW.toISOString(),
  source: quotes.some((item) => item.source === "angelone") ? "angelone" : "yahoo",
  delayed: quotes.some((item) => item.delayed),
  marketPhase: "OPEN",
  quotes,
  errors: [],
  ...overrides,
});
const yahoo = (symbol: string) => quote(symbol, { source: "yahoo", quality: "delayed", delayed: true, ts: "2026-11-06T04:44:00.000Z" });

const SYMBOLS = ["RELIANCE", "TCS"];

describe("quote feed status", () => {
  const cases: Array<{ name: string; requested?: string[]; response: MarketQuotesResponse | undefined; isError?: boolean; state: QuoteFeedState; quoted: number }> = [
    { name: "no response yet", response: undefined, state: "loading", quoted: 0 },
    { name: "request failed before any response", response: undefined, isError: true, state: "unavailable", quoted: 0 },
    { name: "refresh failed after an earlier response", response: response(SYMBOLS.map((s) => quote(s))), isError: true, state: "unavailable", quoted: 2 },
    { name: "missing: empty response", response: response([], { errors: SYMBOLS.map((symbol) => ({ symbol, message: "timeout" })) }), state: "empty", quoted: 0 },
    { name: "nothing requested", requested: [], response: undefined, state: "empty", quoted: 0 },
    { name: "partial: one of two live quotes", response: response([quote("RELIANCE")], { errors: [{ symbol: "TCS", message: "timeout" }] }), state: "live", quoted: 1 },
    { name: "delayed Yahoo fallback while open", response: response([quote("RELIANCE"), yahoo("TCS")]), state: "delayed", quoted: 2 },
    { name: "stale Angel cache after a failed refresh", response: response([quote("RELIANCE", { quality: "stale" }), quote("TCS")]), state: "stale", quoted: 2 },
    { name: "stale Angel print from a previous session", response: response([quote("RELIANCE", { ts: YESTERDAY }), quote("TCS")]), state: "delayed", quoted: 2 },
    { name: "live quality from a non-broker source", response: response([quote("RELIANCE", { source: "simulated" }), quote("TCS")]), state: "delayed", quoted: 2 },
    { name: "market closed", response: response(SYMBOLS.map((s) => quote(s, { quality: "delayed", delayed: true })), { marketPhase: "CLOSED" }), state: "closed", quoted: 2 },
    { name: "holiday", response: response(SYMBOLS.map(yahoo), { marketPhase: "HOLIDAY" }), state: "closed", quoted: 2 },
    { name: "after hours", response: response(SYMBOLS.map(yahoo), { marketPhase: "AFTER_HOURS" }), state: "closed", quoted: 2 },
    { name: "pre-open", response: response(SYMBOLS.map((s) => quote(s, { quality: "delayed", delayed: true })), { marketPhase: "PRE_OPEN" }), state: "pre-open", quoted: 2 },
    { name: "live flags outside the open session", response: response(SYMBOLS.map((s) => quote(s)), { marketPhase: "CLOSED" }), state: "closed", quoted: 2 },
    { name: "phase not reported", response: response(SYMBOLS.map((s) => quote(s)), { marketPhase: undefined }), state: "unverified", quoted: 2 },
    { name: "live: open session, Angel One, today's prints", response: response(SYMBOLS.map((s) => quote(s))), state: "live", quoted: 2 },
  ];

  for (const { name, requested = SYMBOLS, response: data, isError = false, state, quoted } of cases) {
    it(name, () => {
      const feed = quoteFeed({ requested, response: data, isError, now: NOW });
      expect(feed.state).toBe(state);
      expect(feed.quoted).toBe(quoted);
      expect(feed.requested).toBe(requested.length);
    });
  }

  it("calls quotes live only in the live state", () => {
    for (const { requested = SYMBOLS, response: data, isError = false, state } of cases) {
      const feed = quoteFeed({ requested, response: data, isError, now: NOW });
      expect(/\blive\b/i.test(feed.label)).toBe(state === "live");
      expect(/\blive\b/i.test(feed.badge)).toBe(state === "live");
    }
  });

  it("states the coverage of a partial response", () => {
    const feed = quoteFeed({ requested: SYMBOLS, response: response([quote("RELIANCE")]), isError: false, now: NOW });
    expect(feed.label).toContain("1 of 2");
    expect(feed.badge).toContain("1/2");
    const full = quoteFeed({ requested: SYMBOLS, response: response(SYMBOLS.map((s) => quote(s))), isError: false, now: NOW });
    expect(full.label).not.toContain(" of ");
  });

  it("ignores quotes for symbols the caller did not ask for", () => {
    const feed = quoteFeed({ requested: ["RELIANCE"], response: response([quote("RELIANCE"), yahoo("TCS")]), isError: false, now: NOW });
    expect(feed.state).toBe("live");
    expect(feed.quoted).toBe(1);
  });

  it("matches requested symbols case-insensitively and counts duplicates once", () => {
    const feed = quoteFeed({ requested: ["reliance", "RELIANCE", "tcs"], response: response([quote("RELIANCE")]), isError: false, now: NOW });
    expect(feed.quoted).toBe(1);
    expect(feed.requested).toBe(2);
  });

  it("re-checks today's session against the clock, not the response", () => {
    // A response that said live at 15:29 IST is not live the next morning.
    const nextDay = new Date("2026-11-07T04:00:00.000Z");
    expect(quoteFeed({ requested: SYMBOLS, response: response(SYMBOLS.map((s) => quote(s))), isError: false, now: nextDay }).state).toBe("delayed");
  });
});
