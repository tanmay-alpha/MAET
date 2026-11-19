import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as quoteServiceModule from "../../server/domain/market/quote-service";
import * as candleServiceModule from "../../server/domain/market/candle-service";
import * as companyDetailModule from "../../server/domain/company/detail";
import * as companyQueryModule from "../../server/domain/screener/company-query";
import { MAX_MARKET_SYMBOL_LENGTH } from "../../server/domain/market/symbol-pattern";
import { Route as quotesRoute } from "./api.market.quotes";
import { Route as candlesRoute } from "./api.market.candles";
import { Route as companyRoute } from "./api.market.company";
import { Route as companiesRoute } from "./api.market.companies";

// mock.module is process-wide in Bun: snapshot the real modules and put them back afterwards.
const real = {
  quotes: { ...quoteServiceModule },
  candles: { ...candleServiceModule },
  detail: { ...companyDetailModule },
  query: { ...companyQueryModule },
};
afterAll(() => {
  mock.module("../../server/domain/market/quote-service", () => real.quotes);
  mock.module("../../server/domain/market/candle-service", () => real.candles);
  mock.module("../../server/domain/company/detail", () => real.detail);
  mock.module("../../server/domain/screener/company-query", () => real.query);
});

/** What the stubbed server functions do next, and the symbols they were asked for. */
let failure: Error | undefined;
const requested: string[] = [];
const LEAK = "connect ECONNREFUSED db.internal.example:5432";

mock.module("../../server/domain/market/quote-service", () => ({
  ...real.quotes,
  loadQuotes: async (symbols: string[]) => {
    requested.push(...symbols);
    if (failure) throw failure;
    return { quotes: [], errors: [] };
  },
}));
mock.module("../../server/domain/market/candle-service", () => ({
  ...real.candles,
  loadMarketCandles: async (symbol: string) => {
    requested.push(symbol);
    if (failure) throw failure;
    return { source: "database", persisted: true, candles: [] };
  },
}));
mock.module("../../server/domain/company/detail", () => ({
  ...real.detail,
  getCompanyDetail: async (symbol: string) => {
    requested.push(symbol);
    if (failure) throw failure;
    return { symbol };
  },
}));
mock.module("../../server/domain/screener/company-query", () => ({
  ...real.query,
  queryCompanyScreener: async () => {
    if (failure) throw failure;
    return { items: [] };
  },
}));

type Handler = (ctx: { request: Request }) => Promise<Response>;
/** The GET handler a TanStack file route registered, checked rather than cast. */
function getHandler(route: { options: unknown }): Handler {
  const { options } = route;
  if (options && typeof options === "object" && "server" in options) {
    const { server } = options;
    if (server && typeof server === "object" && "handlers" in server) {
      const { handlers } = server;
      if (handlers && typeof handlers === "object" && "GET" in handlers && typeof handlers.GET === "function") {
        const get = handlers.GET;
        return (ctx) => get(ctx);
      }
    }
  }
  throw new Error("route has no GET handler");
}

async function get(route: { options: unknown }, query: string) {
  const res = await getHandler(route)({ request: new Request(`http://localhost/api/market/x?${query}`) });
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  failure = undefined;
  requested.length = 0;
});

describe("same-origin market routes: symbol validation", () => {
  const rejected = ["^NSEI", "REL IANCE", "<script>", "TCS;DROP", "A".repeat(MAX_MARKET_SYMBOL_LENGTH + 1)];

  it("rejects symbols the backend rejects, before any lookup", async () => {
    for (const symbol of rejected) {
      const encoded = encodeURIComponent(symbol);
      expect((await get(quotesRoute, `symbols=RELIANCE,${encoded}`)).status).toBe(400);
      expect((await get(candlesRoute, `symbol=${encoded}`)).status).toBe(400);
      expect((await get(companyRoute, `symbol=${encoded}`)).status).toBe(400);
    }
    expect((await get(companyRoute, "symbol=")).status).toBe(400);
    expect(requested).toEqual([]);
  });

  it("accepts the backend's symbol shapes up to the length cap", async () => {
    const longest = "B".repeat(MAX_MARKET_SYMBOL_LENGTH);
    expect((await get(quotesRoute, `symbols=M%26M,BAJAJ-AUTO,NIFTY50,${longest}`)).status).toBe(200);
    expect(requested).toEqual(["M&M", "BAJAJ-AUTO", "NIFTY50", longest]);
  });

  it("never forwards a symbol outside the backend pattern, for seeded random input", async () => {
    // Small LCG so failures reproduce.
    let seed = 0x5eed;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff);
    const alphabet = "ABCXYZ0189&.-^ <>'\"%;/\\_é";
    for (let round = 0; round < 300; round++) {
      const length = 1 + (next() % 40);
      const symbol = Array.from({ length }, () => alphabet[next() % alphabet.length]).join("");
      await get(quotesRoute, `symbols=${encodeURIComponent(symbol)}`);
      await get(candlesRoute, `symbol=${encodeURIComponent(symbol)}`);
    }
    expect(requested.length).toBeGreaterThan(0);
    for (const symbol of requested) {
      expect(symbol).toMatch(/^[A-Z0-9&.-]+$/);
      expect(symbol.length).toBeLessThanOrEqual(MAX_MARKET_SYMBOL_LENGTH);
    }
  });
});

describe("same-origin market routes: upstream failures", () => {
  it("answers 503 with a fixed message instead of the upstream error text", async () => {
    failure = new Error(LEAK);
    const responses = [
      await get(quotesRoute, "symbols=RELIANCE"),
      await get(candlesRoute, "symbol=RELIANCE"),
      await get(companyRoute, "symbol=RELIANCE"),
      await get(companiesRoute, "page=1&limit=10"),
    ];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.text).not.toContain("ECONNREFUSED");
      expect(response.text).not.toContain("db.internal");
    }
  });

  it("keeps a missing company a 404", async () => {
    failure = new Error("Company not found");
    expect(await get(companyRoute, "symbol=NOSUCHCO")).toEqual({ status: 404, text: JSON.stringify({ message: "Company not found" }) });
  });

  it("does not echo an invalid screener parameter back", async () => {
    const response = await get(companiesRoute, `sortBy=${encodeURIComponent("<img src=x>")}`);
    expect(response.status).toBe(400);
    expect(response.text).not.toContain("<img");
  });
});
