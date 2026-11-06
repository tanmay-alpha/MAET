import { useQuery } from "@tanstack/react-query";
import { fetchMarketCandles, type MarketCandle } from "@/lib/market-api";

export function useMarketCandles(
  symbol: string,
  timeframe: MarketCandle["tf"],
  range: string
) {
  return useQuery({
    queryKey: ["market-candles", symbol, timeframe, range],
    queryFn: ({ signal }) => fetchMarketCandles(symbol, timeframe, range, signal),
    // No `typeof window` gate: queries never run during SSR anyway, and a server-only
    // `enabled: false` makes the server render "not loading" while the client renders
    // "loading", which breaks hydration.
    enabled: Boolean(symbol),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });
}
