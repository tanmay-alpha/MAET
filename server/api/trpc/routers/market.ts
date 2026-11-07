import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { computePhase } from "../../../domain/market/clock";
import { loadQuotes } from "../../../domain/market/quote-service";
import { lookupSymbol } from "../../../domain/market/symbol";
import { getConfig } from "../../../config";

// FIX 2: SSRF protection — strict symbol and range validation.
// Subset of MARKET_SYMBOL_PATTERN (covers M&M, BAJAJ-AUTO) that must start
// alphanumeric and is capped at 20 characters.
const VALID_SYMBOL = /^[A-Z0-9][A-Z0-9&.-]{0,19}$/;

/** Symbol input for procedures that fetch from upstream providers or persist under the symbol. */
export const marketSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(VALID_SYMBOL, "Symbols must be 1-20 uppercase alphanumeric characters with optional & . -");

const VALID_RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"] as const;

export const marketRouter = createRouter({
  // Get quotes for a list of symbols with caching and freshness checks
  getQuotes: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()).max(50),
    }))
    .query(async ({ input }) => {
      // FIX 2: Reject invalid symbols before making outbound requests
      for (const s of input.symbols) {
        if (!VALID_SYMBOL.test(s.toUpperCase())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid symbol: "${s}". Symbols must be uppercase alphanumeric with optional dots/dashes.`,
          });
        }
      }

      // Shared quote path: Angel One first, per-symbol Yahoo fallback, bounded cache.
      const { quotes } = await loadQuotes(input.symbols);
      const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));

      return input.symbols.map((symbol) => {
        const upper = symbol.toUpperCase();
        const quote = bySymbol.get(upper);
        if (!quote) {
          return {
            symbol: upper,
            exchange: "NSE",
            name: symbol,
            price: 0,
            prevClose: 0,
            change: 0,
            changePercent: 0,
            volume: 0,
            lastUpdated: new Date().toISOString(),
            isStale: true,
            warning: "STALE_DATA: No cached data available",
          };
        }
        const prevClose = quote.previousClose ?? 0;
        const change = quote.change ?? (prevClose > 0 ? quote.price - prevClose : 0);
        const changePercent = quote.changePct ?? (prevClose > 0 ? (change / prevClose) * 100 : 0);
        const isStale = quote.quality === "stale";
        return {
          symbol: upper,
          exchange: quote.exchange,
          name: lookupSymbol(quote.exchange, upper)?.name ?? upper,
          price: quote.price,
          prevClose,
          change: Math.round(change * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
          volume: quote.volume,
          lastUpdated: quote.ts,
          isStale,
          ...(isStale ? { warning: "STALE_DATA: Failed to refresh price data" } : {}),
        };
      });
    }),

  // Get historical candles for a symbol
  getCandles: protectedProcedure
    .input(z.object({
      symbol: marketSymbolSchema,
      timeframe: z.string(),
      range: z.string(),
    }))
    .query(async ({ input }) => {
      // FIX 2: Validate range against whitelist
      if (!VALID_RANGES.includes(input.range as typeof VALID_RANGES[number])) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid range "${input.range}". Allowed: ${VALID_RANGES.join(", ")}`,
        });
      }

      try {
        // Map timeframe to Yahoo Finance interval
        const intervalMap: Record<string, string> = {
          '1m': '1m',
          '5m': '5m',
          '15m': '15m',
          '30m': '30m',
          '1h': '1h',
          '1d': '1d',
          '1wk': '1wk',
          '1mo': '1mo',
        };

        const interval = intervalMap[input.timeframe] || '1d';
        const symbol = encodeURIComponent(`${input.symbol}.NS`);

        const response = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${input.range}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; MAET/1.0)',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Yahoo Finance API error: ${response.status}`);
        }

        const data = await response.json();
        const result = data.chart?.result;

        if (!result || result.length === 0) {
          return [];
        }

        const quote = result[0];
        const timestamps = quote.timestamp || [];
        const quoteData = quote.indicators?.quote?.[0] || {};

        return timestamps.map((ts: number, index: number) => ({
          symbol: input.symbol.toUpperCase(),
          timeframe: input.timeframe,
          ts: new Date(ts * 1000).toISOString(),
          open: quoteData.open?.[index] || 0,
          high: quoteData.high?.[index] || 0,
          low: quoteData.low?.[index] || 0,
          close: quoteData.close?.[index] || 0,
          volume: quoteData.volume?.[index] || 0,
          source: "yahoo",
        }));
      } catch (error) {
        console.error("Error fetching candles:", error);
        return [];
      }
    }),

  // Get market clock
  getMarketClock: protectedProcedure
    .query(async () => {
      const now = new Date();
      let holidays: Date[] = [];
      try {
        holidays = getConfig().nseHolidays ?? [];
      } catch {
        holidays = [];
      }

      const phase = computePhase(now, holidays);
      const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const marketStatus: "Live" | "Delayed" | "Closed" = phase === "OPEN" ? "Live" : "Closed";

      return {
        phase,
        ist: istTime.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        marketStatus,
        nseHolidays: holidays.map((h) => h.toISOString().split("T")[0]),
      };
    }),
});
