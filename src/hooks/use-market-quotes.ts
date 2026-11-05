import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  fetchMarketQuotes,
  parseMarketQuote,
  type MarketQuote,
  type MarketQuotesResponse,
} from "@/lib/market-api";
import { API_BASE_URL } from "@/lib/api-url";
import { reconnectDelayMs, scheduleTimeout, type ScheduleFn } from "@/lib/reconnect-backoff";

function mergeQuote(
  response: MarketQuotesResponse | undefined,
  tick: MarketQuote,
  marketPhase: string | undefined
): MarketQuotesResponse {
  const quotes = response?.quotes ? [...response.quotes] : [];
  const index = quotes.findIndex((quote) => quote.symbol === tick.symbol);
  if (index >= 0) quotes[index] = tick;
  else quotes.push(tick);
  return {
    asOf: new Date().toISOString(),
    source: tick.source,
    delayed: quotes.some((quote) => quote.delayed),
    marketPhase: marketPhase ?? response?.marketPhase,
    errors: response?.errors ?? [],
    quotes,
  };
}

type StreamCallback = (quote: MarketQuote, marketPhase: string | undefined) => void;

interface StreamMessage {
  quotes: MarketQuote[];
  marketPhase: string | undefined;
}

// A snapshot carries the full quotes payload ({ delayed, marketPhase?, quotes }); a tick is one quote.
function parseStreamMessage(raw: unknown, type: "tick" | "snapshot"): StreamMessage {
  if (type === "snapshot" && raw !== null && typeof raw === "object" && "quotes" in raw && Array.isArray(raw.quotes)) {
    const responseDelayed = "delayed" in raw && raw.delayed === true;
    const marketPhase = "marketPhase" in raw && typeof raw.marketPhase === "string" ? raw.marketPhase : undefined;
    return {
      quotes: raw.quotes.flatMap((candidate: unknown) => parseMarketQuote(candidate, responseDelayed) ?? []),
      marketPhase,
    };
  }
  const quote = parseMarketQuote(raw);
  return { quotes: quote ? [quote] : [], marketPhase: undefined };
}

export interface MarketStreamDeps {
  baseUrl: string;
  createEventSource: (url: string) => EventSource;
  schedule: ScheduleFn;
  random: () => number;
}

// Coalesces symbol changes from components mounting together into one reconnect.
const SUBSCRIPTION_DEBOUNCE_MS = 400;

/**
 * One EventSource shared by every useMarketQuotes() consumer; the stream URL carries
 * the union of subscribed symbols. Failed connections are retried with capped
 * exponential backoff that resets once a connection opens.
 */
export class MarketStreamManager {
  private static instance: MarketStreamManager | null = null;
  private eventSource: EventSource | null = null;
  private listeners = new Map<string, Set<StreamCallback>>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private cancelReconnect: (() => void) | null = null;
  private failures = 0;
  private isConnected = false;

  constructor(private readonly deps: MarketStreamDeps) {}

  public static getInstance(): MarketStreamManager {
    MarketStreamManager.instance ??= new MarketStreamManager({
      baseUrl: API_BASE_URL,
      createEventSource: (url) => new EventSource(url),
      schedule: scheduleTimeout,
      random: Math.random,
    });
    return MarketStreamManager.instance;
  }

  public subscribe(symbols: string[], callback: StreamCallback, onStatusChange: (connected: boolean) => void): () => void {
    symbols.forEach((symbol) => {
      let symbolListeners = this.listeners.get(symbol);
      if (!symbolListeners) {
        symbolListeners = new Set();
        this.listeners.set(symbol, symbolListeners);
      }
      symbolListeners.add(callback);
    });

    this.statusListeners.add(onStatusChange);
    onStatusChange(this.isConnected);
    this.onSubscriptionsChanged();

    return () => {
      symbols.forEach((symbol) => {
        const symbolListeners = this.listeners.get(symbol);
        if (!symbolListeners) return;
        symbolListeners.delete(callback);
        if (symbolListeners.size === 0) this.listeners.delete(symbol);
      });
      this.statusListeners.delete(onStatusChange);
      this.onSubscriptionsChanged();
    };
  }

  private onSubscriptionsChanged() {
    // While backing off after failures, the pending retry picks up the new symbol set;
    // rescheduling it at the debounce interval would defeat the backoff.
    if (this.failures > 0 && this.cancelReconnect !== null) return;
    this.scheduleReconnect(SUBSCRIPTION_DEBOUNCE_MS);
  }

  private scheduleReconnect(delayMs: number) {
    this.cancelReconnect?.();
    this.cancelReconnect = this.deps.schedule(() => {
      this.cancelReconnect = null;
      this.reconnect();
    }, delayMs);
  }

  private reconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.listeners.size === 0) {
      this.failures = 0;
      this.setConnected(false);
      return;
    }

    const params = new URLSearchParams();
    Array.from(this.listeners.keys()).sort().forEach((symbol) => params.append("symbols", symbol));

    let source: EventSource;
    try {
      source = this.deps.createEventSource(`${this.deps.baseUrl}/api/market/stream?${params}`);
    } catch (err) {
      console.error("Error creating EventSource:", err);
      this.scheduleReconnect(reconnectDelayMs(this.failures++, this.deps.random));
      return;
    }
    this.eventSource = source;

    source.onopen = () => {
      this.failures = 0;
      this.setConnected(true);
    };

    const handleMessage = (type: "tick" | "snapshot") => (event: MessageEvent<string>) => {
      try {
        const { quotes, marketPhase } = parseStreamMessage(JSON.parse(event.data), type);
        quotes.forEach((quote) => {
          this.listeners.get(quote.symbol)?.forEach((callback) => callback(quote, marketPhase));
        });
      } catch (error: unknown) {
        console.error("Failed to parse market stream message:", error);
      }
    };

    const onSnapshot = handleMessage("snapshot") as EventListener;
    const onTick = handleMessage("tick") as EventListener;
    source.addEventListener("snapshot", onSnapshot);
    source.addEventListener("tick", onTick);

    source.onerror = () => {
      // Close instead of relying on EventSource's built-in retry, which reconnects
      // at a fixed interval forever; we back off instead.
      source.removeEventListener("snapshot", onSnapshot);
      source.removeEventListener("tick", onTick);
      source.close();
      if (this.eventSource === source) this.eventSource = null;
      this.setConnected(false);
      this.scheduleReconnect(reconnectDelayMs(this.failures++, this.deps.random));
    };
  }

  private setConnected(connected: boolean) {
    if (this.isConnected === connected) return;
    this.isConnected = connected;
    this.statusListeners.forEach((listener) => listener(connected));
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
    // Not gated on `typeof window`: that would make server and client loading states differ.
    enabled: normalized.length > 0,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  useEffect(() => {
    if (typeof window === "undefined" || normalized.length === 0 || !API_BASE_URL) return;

    return MarketStreamManager.getInstance().subscribe(
      normalized,
      (quote, marketPhase) => {
        queryClient.setQueryData<MarketQuotesResponse>(queryKey, (current) => mergeQuote(current, quote, marketPhase));
      },
      setStreamConnected
    );
  }, [normalized, queryClient, queryKey]);

  const quoteMap = useMemo(
    () => new Map((query.data?.quotes ?? []).map((quote) => [quote.symbol, quote])),
    [query.data?.quotes]
  );

  return {
    ...query,
    quoteMap,
    streamConnected,
    delayed: query.data?.delayed ?? true,
    marketPhase: query.data?.marketPhase,
    asOf: query.data?.asOf,
  };
}
