import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  API_BASE_URL,
  fetchMarketQuotes,
  type MarketQuote,
  type MarketQuotesResponse,
} from "@/lib/market-api";

function mergeQuote(response: MarketQuotesResponse | undefined, tick: MarketQuote): MarketQuotesResponse {
  const quotes = response?.quotes ? [...response.quotes] : [];
  const index = quotes.findIndex((quote) => quote.symbol === tick.symbol);
  if (index >= 0) quotes[index] = tick;
  else quotes.push(tick);
  return {
    asOf: new Date().toISOString(),
    source: tick.source,
    delayed: tick.source !== "angelone",
    errors: response?.errors ?? [],
    quotes,
  };
}

export function useMarketQuotes(symbols: string[]) {
  const symbolInput = symbols.join(",");
  const normalized = useMemo(
    () => [...new Set(symbolInput.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort(),
    [symbolInput]
  );
  const symbolKey = normalized.join(",");
  const queryKey = useMemo(() => ["market-quotes", symbolKey] as const, [symbolKey]);
  const queryClient = useQueryClient();
  const [streamConnected, setStreamConnected] = useState(false);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchMarketQuotes(normalized, signal),
    enabled: typeof window !== "undefined" && normalized.length > 0,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  useEffect(() => {
    if (typeof window === "undefined" || normalized.length === 0) return;
    const params = new URLSearchParams({ symbols: symbolKey });
    const source = new EventSource(`${API_BASE_URL}/api/market/stream?${params}`);

    source.onopen = () => setStreamConnected(true);
    source.addEventListener("tick", (event) => {
      const tick = JSON.parse((event as MessageEvent<string>).data) as MarketQuote;
      queryClient.setQueryData<MarketQuotesResponse>(queryKey, (current) => mergeQuote(current, tick));
    });
    source.addEventListener("snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as Pick<
        MarketQuotesResponse,
        "quotes" | "errors"
      >;
      queryClient.setQueryData<MarketQuotesResponse>(queryKey, (current) => ({
        asOf: new Date().toISOString(),
        source: current?.source ?? "yahoo",
        delayed: current?.delayed ?? true,
        quotes: snapshot.quotes,
        errors: snapshot.errors,
      }));
    });
    source.onerror = () => setStreamConnected(false);

    return () => {
      source.close();
      setStreamConnected(false);
    };
  }, [normalized.length, queryClient, queryKey, symbolKey]);

  const quoteMap = useMemo(
    () => new Map((query.data?.quotes ?? []).map((quote) => [quote.symbol, quote])),
    [query.data?.quotes]
  );

  return {
    ...query,
    quoteMap,
    streamConnected,
    delayed: query.data?.delayed ?? true,
    asOf: query.data?.asOf,
  };
}
