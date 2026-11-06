import { useQuery } from "@tanstack/react-query";
import { fetchCorporateActions } from "@/lib/market-api";

/** Provider-reported dividends and splits for a symbol, newest first; the server caches them for 24h. */
export function useCorporateActions(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["corporate-actions", symbol],
    queryFn: () => fetchCorporateActions(symbol),
    enabled: Boolean(symbol) && enabled,
    staleTime: 60 * 60_000,
    retry: 1,
  });
}
