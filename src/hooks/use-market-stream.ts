import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { Quote } from "../lib/api-client";
import { API_BASE_URL } from "../lib/market-api";
import { useTerminalStore } from "../store/useTerminalStore";

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface UseMarketStreamOptions {
  symbols: string[];
  onQuotes?: (quotes: Quote[]) => void;
  onError?: (error: Error) => void;
}

interface UseMarketStreamResult {
  quotes: Map<string, Quote>;
  isConnected: boolean;
  error: Error | null;
  reconnectAttempts: number;
}

export function useMarketStream({
  symbols,
  onQuotes,
  onError,
}: UseMarketStreamOptions): UseMarketStreamResult {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const reconnectAttemptsRef = useRef(0);
  const [reconnectAttempts, setReconnectAttemptsState] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Use stable refs for callback props to prevent rebuilding the connect function
  // when references to callbacks change across parent renders.
  const onQuotesRef = useRef(onQuotes);
  const onErrorRef = useRef(onError);
  
  useEffect(() => {
    onQuotesRef.current = onQuotes;
    onErrorRef.current = onError;
  });

  // Serialize symbols to avoid triggers when symbols array reference changes
  const symbolKey = useMemo(() => {
    return [...new Set(symbols)].sort().join(",");
  }, [symbols]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (!symbolKey) return;

    // Close existing connection and remove its event listeners
    if (eventSourceRef.current) {
      const oldEs = eventSourceRef.current;
      if ((oldEs as any)._cleanup) {
        (oldEs as any)._cleanup();
      }
      oldEs.close();
    }

    const params = new URLSearchParams();
    symbolKey.split(",").forEach((s) => params.append("symbols", s));
    const url = `${API_BASE_URL}/api/market/stream?${params}`;

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        setReconnectAttemptsState(0);
      };

      const handleQuotes = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          const newQuotes: Quote[] = Array.isArray(data)
            ? data
            : Array.isArray(data.quotes)
              ? data.quotes
              : [data];

          setQuotes((prev) => {
            const updated = new Map(prev);
            newQuotes.forEach((quote) => {
              updated.set(quote.symbol, quote);
            });
            return updated;
          });

          onQuotesRef.current?.(newQuotes);

          // Stream L2 Depth and Options Greeks to Zustand store if present
          const activeSymbol = useTerminalStore.getState().activeSymbol;
          newQuotes.forEach((q: any) => {
            if (q.symbol === activeSymbol) {
              if (q.level2) {
                useTerminalStore.getState().setLevel2Depth(q.level2);
              }
              if (q.greeks) {
                useTerminalStore.getState().setActiveGreeks(q.greeks);
              }
            }
          });
        } catch (parseError) {
          console.error("Failed to parse SSE message:", parseError);
        }
      };

      eventSource.addEventListener("snapshot", handleQuotes as EventListener);
      eventSource.addEventListener("tick", handleQuotes as EventListener);

      const cleanupListeners = () => {
        eventSource.removeEventListener("snapshot", handleQuotes as EventListener);
        eventSource.removeEventListener("tick", handleQuotes as EventListener);
      };

      eventSource.onerror = () => {
        if (!mountedRef.current) return;

        setIsConnected(false);
        cleanupListeners();
        eventSource.close();

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current += 1;
          setReconnectAttemptsState(reconnectAttemptsRef.current);
          setError(new Error(`Connection lost. Reconnecting in ${delay / 1000}s...`));

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          const err = new Error("Max reconnection attempts reached. Please refresh the page.");
          setError(err);
          onErrorRef.current?.(err);
        }
      };

      // Save listener cleanup so we can clean up before closing EventSource
      (eventSource as any)._cleanup = cleanupListeners;

    } catch (err) {
      setError(err as Error);
      onErrorRef.current?.(err as Error);
    }
  }, [symbolKey]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        const es = eventSourceRef.current;
        if ((es as any)._cleanup) {
          (es as any)._cleanup();
        }
        es.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  // Memoize results to optimize renders for React compiler/re-renders
  return useMemo(() => ({
    quotes,
    isConnected,
    error,
    reconnectAttempts,
  }), [quotes, isConnected, error, reconnectAttempts]);
}

// Hook for single symbol price
export function useLivePrice(symbol: string): Quote | null {
  const { quotes } = useMarketStream({
    symbols: useMemo(() => [symbol], [symbol]),
  });
  return quotes.get(symbol) ?? null;
}

// Hook for multiple symbols
export function useLivePrices(symbols: string[]): Map<string, Quote> {
  const { quotes } = useMarketStream({ symbols });
  return quotes;
}
