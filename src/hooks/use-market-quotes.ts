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

type StreamCallback = (type: "tick" | "snapshot", data: any) => void;

class MarketStreamManager {
  private static instance: MarketStreamManager | null = null;
  private eventSource: EventSource | null = null;
  private listeners = new Map<string, Set<StreamCallback>>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private activeSymbols = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;

  private constructor() {}

  public static getInstance(): MarketStreamManager {
    if (!MarketStreamManager.instance) {
      MarketStreamManager.instance = new MarketStreamManager();
    }
    return MarketStreamManager.instance;
  }

  public subscribe(symbols: string[], callback: StreamCallback, onStatusChange: (connected: boolean) => void): () => void {
    symbols.forEach(symbol => {
      let symbolListeners = this.listeners.get(symbol);
      if (!symbolListeners) {
        symbolListeners = new Set();
        this.listeners.set(symbol, symbolListeners);
      }
      symbolListeners.add(callback);
      this.activeSymbols.add(symbol);
    });

    this.statusListeners.add(onStatusChange);
    onStatusChange(this.isConnected);

    this.debounceReconnect();

    return () => {
      symbols.forEach(symbol => {
        const symbolListeners = this.listeners.get(symbol);
        if (symbolListeners) {
          symbolListeners.delete(callback);
          if (symbolListeners.size === 0) {
            this.listeners.delete(symbol);
            this.activeSymbols.delete(symbol);
          }
        }
      });
      
      this.statusListeners.delete(onStatusChange);
      this.debounceReconnect();
    };
  }

  private debounceReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, 400); // 400ms debounce
  }

  private reconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.activeSymbols.size === 0) {
      if (this.isConnected) {
        this.isConnected = false;
        this.notifyStatus(false);
      }
      return;
    }

    const sortedSymbols = Array.from(this.activeSymbols).sort();
    const params = new URLSearchParams();
    sortedSymbols.forEach(s => params.append("symbols", s));
    const url = `${API_BASE_URL}/api/market/stream?${params}`;

    try {
      const source = new EventSource(url);
      this.eventSource = source;

      source.onopen = () => {
        this.isConnected = true;
        this.notifyStatus(true);
      };

      const handleMessage = (type: "tick" | "snapshot") => (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data);

          if (type === "snapshot") {
            const quotes = data.quotes || [];
            quotes.forEach((quote: any) => {
              const symbol = quote.symbol;
              const symbolListeners = this.listeners.get(symbol);
              if (symbolListeners) {
                symbolListeners.forEach(cb => cb("snapshot", { quotes: [quote], errors: [] }));
              }
            });
          } else {
            const symbol = data.symbol;
            const symbolListeners = this.listeners.get(symbol);
            if (symbolListeners) {
              symbolListeners.forEach(cb => cb("tick", data));
            }
          }
        } catch (e) {
          console.error("Failed to parse market stream message:", e);
        }
      };

      const onSnapshot = handleMessage("snapshot") as EventListener;
      const onTick = handleMessage("tick") as EventListener;

      source.addEventListener("snapshot", onSnapshot);
      source.addEventListener("tick", onTick);

      source.onerror = () => {
        this.eventSource = null;
        this.isConnected = false;
        this.notifyStatus(false);
        // Remove event listeners before closing to prevent memory leaks
        source.removeEventListener("snapshot", onSnapshot);
        source.removeEventListener("tick", onTick);
        source.close();
        // Trigger reconnect with exponential backoff
        this.debounceReconnect();
      };
    } catch (err) {
      console.error("Error creating EventSource:", err);
    }
  }

  private notifyStatus(connected: boolean) {
    this.statusListeners.forEach(listener => listener(connected));
  }
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
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  useEffect(() => {
    if (typeof window === "undefined" || normalized.length === 0 || !API_BASE_URL) return;

    const manager = MarketStreamManager.getInstance();
    const unsubscribe = manager.subscribe(
      normalized,
      (type, data) => {
        if (type === "tick") {
          queryClient.setQueryData<MarketQuotesResponse>(queryKey, (current) => mergeQuote(current, data));
        } else if (type === "snapshot") {
          data.quotes.forEach((quote: any) => {
            queryClient.setQueryData<MarketQuotesResponse>(queryKey, (current) => mergeQuote(current, quote));
          });
        }
      },
      (connected) => {
        setStreamConnected(connected);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [symbolKey, queryClient, queryKey]);

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
