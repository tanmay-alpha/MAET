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
import { MAX_STREAM_SYMBOLS } from "@shared/types";

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
  /**
   * HTTP status the stream URL answers with. EventSource hides the status of a
   * failed connection, so this is asked only when the browser gave up on it.
   */
  probeStatus: (url: string) => Promise<number>;
  warn: (message: string) => void;
}

const EVENT_SOURCE_CLOSED = 2;

async function probeStreamStatus(url: string): Promise<number> {
  const controller = new AbortController();
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "text/event-stream" } });
    return response.status;
  } finally {
    // Only the status line is needed; drop the (possibly open) stream at once.
    controller.abort();
  }
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
  /** Symbol → subscribed callbacks, each with its subscription order (higher = newer). */
  private listeners = new Map<string, Map<StreamCallback, number>>();
  private nextSubscription = 0;
  private warnedTruncation = false;
  /** Stream URL the server rejected with 400; not retried until the symbol set changes. */
  private rejectedUrl: string | null = null;
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
      probeStatus: probeStreamStatus,
      warn: import.meta.env.DEV ? (message) => console.warn(message) : () => {},
    });
    return MarketStreamManager.instance;
  }

  public subscribe(symbols: string[], callback: StreamCallback, onStatusChange: (connected: boolean) => void): () => void {
    const order = this.nextSubscription++;
    symbols.forEach((symbol) => {
      let symbolListeners = this.listeners.get(symbol);
      if (!symbolListeners) {
        symbolListeners = new Map();
        this.listeners.set(symbol, symbolListeners);
      }
      symbolListeners.set(callback, order);
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

    const url = this.streamUrl();
    // A 400 is the server rejecting this exact symbol set; retrying it cannot succeed.
    if (url === this.rejectedUrl) {
      this.failures = 0;
      this.setConnected(false);
      return;
    }

    let source: EventSource;
    try {
      source = this.deps.createEventSource(url);
    } catch (err) {
      console.error("Error creating EventSource:", err);
      this.scheduleReconnect(reconnectDelayMs(this.failures++, this.deps.random));
      return;
    }
    this.eventSource = source;

    let opened = false;
    source.onopen = () => {
      opened = true;
      this.failures = 0;
      this.setConnected(true);
    };

    const handleMessage = (type: "tick" | "snapshot") => (event: MessageEvent<string>) => {
      try {
        const { quotes, marketPhase } = parseStreamMessage(JSON.parse(event.data), type);
        quotes.forEach((quote) => {
          for (const callback of this.listeners.get(quote.symbol)?.keys() ?? []) callback(quote, marketPhase);
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
      // CLOSED before ever opening means the browser failed the connection on
      // its HTTP response (not a network drop, which leaves it CONNECTING).
      if (!opened && source.readyState === EVENT_SOURCE_CLOSED) {
        void this.deps.probeStatus(url)
          .catch(() => 0)
          .then((status) => {
            if (this.eventSource !== null || this.cancelReconnect !== null) return;
            if (status === 400) {
              this.rejectedUrl = url;
              this.failures = 0;
              return;
            }
            this.scheduleReconnect(reconnectDelayMs(this.failures++, this.deps.random));
          });
        return;
      }
      this.scheduleReconnect(reconnectDelayMs(this.failures++, this.deps.random));
    };
  }

  /**
   * Stream URL for the current subscriptions, capped at MAX_STREAM_SYMBOLS.
   * When over the cap, symbols of the most recent subscribers (the page the
   * user just opened) win over older ones such as the header ticker.
   */
  private streamUrl(): string {
    const newestOrder = (symbol: string) => Math.max(...(this.listeners.get(symbol)?.values() ?? []));
    let symbols = Array.from(this.listeners.keys());
    if (symbols.length > MAX_STREAM_SYMBOLS) {
      symbols = symbols
        .sort((a, b) => newestOrder(b) - newestOrder(a) || a.localeCompare(b))
        .slice(0, MAX_STREAM_SYMBOLS);
      if (!this.warnedTruncation) {
        this.warnedTruncation = true;
        this.deps.warn(
          `Market stream limited to ${MAX_STREAM_SYMBOLS} symbols; ${this.listeners.size - MAX_STREAM_SYMBOLS} older subscriptions fall back to polling.`
        );
      }
    }
    const params = new URLSearchParams();
    symbols.sort().forEach((symbol) => params.append("symbols", symbol));
    return `${this.deps.baseUrl}/api/market/stream?${params}`;
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
