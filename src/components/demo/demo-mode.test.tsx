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

const quote: MarketQuote = {
  symbol: "DEMO-ALPHA", exchange: "NSE", price: 812.5, ts: "2026-11-06T10:00:00.000Z",
  source: "simulated", quality: "synthetic", delayed: false,
};
const yahoo: MarketQuote = { ...quote, symbol: "RELIANCE", price: 2450, source: "yahoo", quality: "delayed", delayed: true };
const response = (quotes: MarketQuote[]): MarketQuotesResponse => ({ asOf: quote.ts, source: quotes[0].source, delayed: false, quotes, errors: [] });

// Labels state each quote's own source: a demo build can also serve real public quotes.
for (const build of ["1", undefined]) {
  describe(`quote labels in ${build ? "a demo" : "an ordinary"} build`, () => {
    test("a seeded DEMO- (simulated) quote is labelled synthetic everywhere", () => {
      setDemoBuild(build);
      expect(quoteSourceLabel("simulated", false, "OPEN")).toBe(SYNTHETIC_QUOTE_LABEL);
      expect(quoteTooltip(quote)).toStartWith(`${SYNTHETIC_QUOTE_LABEL} · `);
      expect(quoteSourceTitle(quote)).toBe(`Quote source: ${SYNTHETIC_QUOTE_LABEL}`);
      expect(quoteProviderName("simulated")).toBe(SYNTHETIC_QUOTE_LABEL);
      expect(marketSummary(response([quote]))).toStartWith(`${SYNTHETIC_QUOTE_LABEL} · `);
    });

    test("a real Yahoo quote keeps its provider and delay", () => {
      setDemoBuild(build);
      expect(quoteSourceLabel("yahoo", true)).toBe("Yahoo · delayed");
      expect(quoteSourceLabel("yahoo", true, "CLOSED")).toBe("Yahoo · delayed · market closed");
      expect(quoteSourceLabel("angelone", false, "OPEN")).toBe("Angel One · live");
      expect(quoteTooltip(yahoo)).toStartWith("Yahoo · delayed · ");
      expect(quoteTooltip({ ...yahoo, quality: "stale" })).toStartWith("Yahoo · delayed · stale · ");
      expect(quoteSourceTitle(yahoo)).toBe("Quote source: Yahoo · delayed");
      expect(quoteSourceTitle(undefined)).toBe("Quote unavailable");
      expect(quoteProviderName("yahoo")).toBe("Yahoo");
      expect(marketSummary(response([yahoo]))).toStartWith("Yahoo Finance · ");
      expect(marketSummary(response([yahoo, quote]))).toStartWith(`Yahoo Finance + ${SYNTHETIC_QUOTE_LABEL} · `);
    });
  });
}
