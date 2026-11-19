import { afterEach, describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { quoteProviderName, quoteSourceLabel, quoteSourceTitle } from "@/lib/quote-source";
import { marketSummary, quoteTooltip } from "@/components/landing/market-presentation";
import type { MarketQuote, MarketQuotesResponse } from "@/lib/market-api";
import { DemoModeBanner } from "./demo-mode-banner";
import { DEMO_BANNER_TEXT, SYNTHETIC_QUOTE_LABEL } from "./demo-mode";

// Vite inlines import.meta.env at build time. Under Bun it is the process environment object,
// read on each access; written through import.meta.env so a test that swaps `process.env` for a
// copy (server/config.test.ts) cannot detach it.
const env = import.meta.env as Record<string, string | undefined>; // the build-time typing is read-only
const original = env.VITE_MAET_DEMO_MODE;
function setDemoBuild(value: string | undefined) {
  if (value === undefined) delete env.VITE_MAET_DEMO_MODE;
  else env.VITE_MAET_DEMO_MODE = value;
}
afterEach(() => setDemoBuild(original));

describe("demo mode banner", () => {
  test("a demo build states that the data is synthetic and offers no way to dismiss it", () => {
    setDemoBuild("1");
    const html = renderToString(<DemoModeBanner />);
    expect(html).toContain(DEMO_BANNER_TEXT);
    expect(DEMO_BANNER_TEXT).toBe("Demo — synthetic data, not market data");
    expect(html).not.toContain("<button");
  });

  test("an ordinary build renders nothing", () => {
    setDemoBuild(undefined);
    expect(renderToString(<DemoModeBanner />)).toBe("");
    setDemoBuild("0");
    expect(renderToString(<DemoModeBanner />)).toBe("");
  });
});

describe("quote labels", () => {
  test("a demo build labels every quote synthetic, whatever source it reports", () => {
    setDemoBuild("1");
    expect(quoteSourceLabel("angelone", false, "OPEN")).toBe(SYNTHETIC_QUOTE_LABEL);
    expect(quoteSourceLabel("yahoo", true, "CLOSED")).toBe(SYNTHETIC_QUOTE_LABEL);
  });

  test("an ordinary build never calls a simulated quote live", () => {
    setDemoBuild(undefined);
    expect(quoteSourceLabel("simulated", false, "OPEN")).toBe("Simulated · synthetic");
    expect(quoteSourceLabel("angelone", false, "OPEN")).toBe("Angel One · live");
  });
});

describe("quote tooltips and provenance lines", () => {
  const quote: MarketQuote = {
    symbol: "RELIANCE", exchange: "NSE", price: 2450, ts: "2026-11-06T10:00:00.000Z",
    source: "angelone", quality: "live", delayed: false,
  };
  const response: MarketQuotesResponse = { asOf: quote.ts, source: "angelone", delayed: false, quotes: [quote], errors: [] };

  test("a demo build names no provider in the index, heatmap and watchlist tooltips or the source line", () => {
    setDemoBuild("1");
    expect(quoteTooltip(quote)).toStartWith(`${SYNTHETIC_QUOTE_LABEL} · `);
    expect(quoteTooltip(quote)).not.toContain("Angel One");
    expect(quoteSourceTitle(quote)).toBe(`Quote source: ${SYNTHETIC_QUOTE_LABEL}`);
    expect(quoteProviderName("yahoo")).toBe(SYNTHETIC_QUOTE_LABEL);
    expect(marketSummary(response)).toStartWith(`${SYNTHETIC_QUOTE_LABEL} · `);
  });

  test("an ordinary build names the provider and its delay", () => {
    setDemoBuild(undefined);
    expect(quoteTooltip(quote)).toStartWith("Angel One · live · ");
    expect(quoteTooltip({ ...quote, source: "yahoo", delayed: true, quality: "stale" })).toStartWith("Yahoo · delayed · stale · ");
    expect(quoteSourceTitle(quote)).toBe("Quote source: Angel One · live");
    expect(quoteSourceTitle(undefined)).toBe("Quote unavailable");
    expect(quoteProviderName("angelone")).toBe("Angel One");
    expect(marketSummary(response)).toStartWith("Angel One · ");
  });
});
