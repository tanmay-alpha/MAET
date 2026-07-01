/**
 * useMarketStream - Real-time market data via SSE
 *
 * Replaces the mock use-live-price hook with real SSE stream connection.
 * Automatically reconnects on disconnect.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Quote } from "../lib/api-client";
import { API_BASE_URL } from "../lib/market-api";

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
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (symbols.length === 0) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Build SSE URL
    const params = new URLSearchParams();
    symbols.forEach((s) => params.append("symbols", s));
    const url = `${API_BASE_URL}/api/market/stream?${params}`;

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setError(null);
        setReconnectAttempts(0);
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

          onQuotes?.(newQuotes);
        } catch (parseError) {
          console.error("Failed to parse SSE message:", parseError);
        }
      };
      eventSource.addEventListener("snapshot", handleQuotes as EventListener);
      eventSource.addEventListener("tick", handleQuotes as EventListener);

      eventSource.onerror = () => {
        if (!mountedRef.current) return;

        setIsConnected(false);
        eventSource.close();

        // Attempt reconnection with exponential backoff
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts);
          setReconnectAttempts((prev) => prev + 1);
          setError(new Error(`Connection lost. Reconnecting in ${delay / 1000}s...`));

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          const err = new Error("Max reconnection attempts reached. Please refresh the page.");
          setError(err);
          onError?.(err);
        }
      };
    } catch (err) {
      setError(err as Error);
      onError?.(err as Error);
    }
  }, [symbols, onQuotes, onError, reconnectAttempts]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;

      // Cleanup
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return {
    quotes,
    isConnected,
    error,
    reconnectAttempts,
  };
}

// Hook for single symbol price
export function useLivePrice(symbol: string): Quote | null {
  const { quotes } = useMarketStream({
    symbols: [symbol],
  });
  return quotes.get(symbol) ?? null;
}

// Hook for multiple symbols
export function useLivePrices(symbols: string[]): Map<string, Quote> {
  const { quotes } = useMarketStream({ symbols });
  return quotes;
}
