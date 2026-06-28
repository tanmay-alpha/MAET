import { router, protectedProcedure } from "../index";
import { createTRPCRouter } from "../index";
import { z } from "zod";

export const marketRouter = router({
  // Get quotes for a list of symbols
  getQuotes: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()),
    }))
    .query(async ({ input, ctx }) => {
      // Mock implementation - would connect to market data workers
      const mockQuotes = input.symbols.map(symbol => ({
        symbol: symbol.toUpperCase(),
        exchange: "NSE",
        name: `${symbol} Company`,
        price: Math.random() * 1000,
        prevClose: Math.random() * 1000,
        change: Math.random() * 100 - 50,
        changePercent: Math.random() * 10 - 5,
        volume: Math.floor(Math.random() * 1000000),
        lastUpdated: new Date().toISOString(),
      }));

      return mockQuotes;
    }),

  // Get historical candles for a symbol
  getCandles: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      timeframe: z.string(),
      range: z.string(),
    }))
    .query(async ({ input }) => {
      // Mock candle data
      const candles = [];
      const basePrice = 500 + Math.random() * 500;

      for (let i = 0; i < 100; i++) {
        const candle = {
          symbol: input.symbol,
          timeframe: input.timeframe,
          ts: new Date(Date.now() - (100 - i) * 60000).toISOString(),
          open: basePrice + Math.random() * 10,
          high: basePrice + Math.random() * 10 + 5,
          low: basePrice + Math.random() * 10 - 5,
          close: basePrice + Math.random() * 10,
          volume: Math.floor(Math.random() * 100000),
          source: "yahoo",
        };
        candles.push(candle);
      }

      return candles;
    }),

  // Get market clock
  getMarketClock: protectedProcedure
    .query(async () => {
      return {
        phase: "PRE_OPEN", // PRE_OPEN, OPEN, CLOSED, HOLIDAY, AFTER_HOURS
        ist: new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }),
        marketStatus: "Delayed", // Live, Delayed, Closed
        nseHolidays: ["2026-01-26", "2026-08-15", "2026-10-02"], // Static for now
      };
    }),
});

// Export the market router
export { marketRouter };