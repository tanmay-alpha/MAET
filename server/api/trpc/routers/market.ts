import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";

function isDerivative(symbol: string): boolean {
  const clean = symbol.toUpperCase();
  const isOption = clean.endsWith("CE") || clean.endsWith("PE") || /\d{5}[CP]E/i.test(clean);
  const isFuture = clean.endsWith("FUT") || clean.includes("FUT");
  return isOption || isFuture;
}

type CachedQuote = {
  symbol: string;
  exchange: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePercent: number;
  volume: number;
  lastUpdated: string;
  fetchedAt: number;
};

const quoteCache = new Map<string, CachedQuote>();

export const marketRouter = createRouter({
  // Get quotes for a list of symbols with caching and freshness checks
  getQuotes: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()),
    }))
    .query(async ({ input }) => {
      const now = Date.now();
      const symbolsToFetch: string[] = [];
      const resultsMap = new Map<string, any>();

      for (const symbol of input.symbols) {
        const upper = symbol.toUpperCase();
        const cached = quoteCache.get(upper);
        const maxAge = isDerivative(symbol) ? 5000 : 30000;
        if (cached && (now - cached.fetchedAt < maxAge)) {
          resultsMap.set(upper, { ...cached, isStale: false });
        } else {
          symbolsToFetch.push(symbol);
        }
      }

      if (symbolsToFetch.length > 0) {
        try {
          const symbolsQuery = symbolsToFetch.map(s => `${s}.NS`).join(",");
          const response = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbolsQuery}?interval=1d&range=1d`,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MAET/1.0)',
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            const result = data.chart?.result;

            if (result && result.length > 0) {
              result.forEach((quote: any, index: number) => {
                const meta = quote.meta;
                const origSymbol = symbolsToFetch[index] || meta.symbol.replace('.NS', '');
                const symbol = origSymbol.toUpperCase();
                const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
                const price = meta.regularMarketPrice || 0;
                const change = price - prevClose;
                const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

                const quoteItem = {
                  symbol,
                  exchange: "NSE",
                  name: meta.longName || symbol,
                  price,
                  prevClose,
                  change: Math.round(change * 100) / 100,
                  changePercent: Math.round(changePercent * 100) / 100,
                  volume: meta.regularMarketVolume || 0,
                  lastUpdated: new Date().toISOString(),
                  fetchedAt: Date.now(),
                };

                quoteCache.set(symbol, quoteItem);
                resultsMap.set(symbol, { ...quoteItem, isStale: false });
              });
            }
          }
        } catch (error) {
          console.error("Error fetching quotes from Yahoo Finance:", error);
        }
      }

      return input.symbols.map(symbol => {
        const upper = symbol.toUpperCase();
        const cached = quoteCache.get(upper);
        if (resultsMap.has(upper)) {
          return resultsMap.get(upper);
        } else if (cached) {
          return {
            ...cached,
            isStale: true,
            warning: "STALE_DATA: Failed to refresh price data",
          };
        } else {
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
      });
    }),

  // Get historical candles for a symbol
  getCandles: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      timeframe: z.string(),
      range: z.string(),
    }))
    .query(async ({ input }) => {
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
        const symbol = `${input.symbol}.NS`;

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
      const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const hours = istTime.getHours();
      const minutes = istTime.getMinutes();
      const timeInMinutes = hours * 60 + minutes;

      // NSE Market hours: 9:15 AM to 3:30 PM IST
      const marketOpen = 9 * 60 + 15; // 9:15 AM
      const marketClose = 15 * 60 + 30; // 3:30 PM

      let phase: string;
      let marketStatus: string;

      if (timeInMinutes >= marketOpen && timeInMinutes < marketClose) {
        phase = "OPEN";
        marketStatus = "Live";
      } else if (timeInMinutes >= marketClose && timeInMinutes < 16 * 60 + 30) {
        phase = "AFTER_HOURS";
        marketStatus = "Closed";
      } else if (timeInMinutes < marketOpen && timeInMinutes >= 5 * 60) {
        phase = "PRE_OPEN";
        marketStatus = "Pre-Open";
      } else {
        phase = "CLOSED";
        marketStatus = "Closed";
      }

      return {
        phase,
        ist: istTime.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        marketStatus,
        nseHolidays: [], // TODO: Load from NSE holiday list
      };
    }),
});
