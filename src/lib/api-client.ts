/**
 * MAET API Client
 *
 * Type-safe API client for communicating with the MAET backend.
 * Uses VITE_API_URL environment variable (set in Vercel dashboard).
 * Uses the same canonical base URL and market contracts as the live-data hooks.
 */

import {
  API_BASE_URL,
  type MarketCandle,
  type MarketCandlesResponse,
  type MarketQuote,
  type MarketQuotesResponse,
} from "./market-api";

// Type definitions matching backend schemas
export type Quote = MarketQuote;
export type Candle = MarketCandle;

export interface MarketClock {
  phase: "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "AFTER_HOURS";
  ist: string;
  marketStatus: "Live" | "Delayed" | "Closed";
  nseHolidays: string[];
}

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  exchange: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "SL" | "SL-M";
  qty: number;
  limitPrice?: number;
  triggerPrice?: number;
  status: "pending" | "partial" | "filled" | "cancelled" | "rejected";
  idempotencyKey: string;
  rejectReason?: string;
  placedAt: string;
  filledAt?: string;
  updatedAt: string;
}

export interface HealthCheck {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version: string;
  checks?: Record<string, {
    name: string;
    ok: boolean;
    detail?: string;
  }>;
}

// Error handling
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Generic fetch wrapper with error handling
async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.message || `HTTP ${response.status}`,
        response.status,
        errorData.code
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network errors
    throw new ApiError(
      `Network error: ${(error as Error).message}`,
      0
    );
  }
}

// API Client class
export const api = {
  // Health check
  async getHealth(): Promise<HealthCheck> {
    return apiFetch<HealthCheck>("/health");
  },

  // Market data
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const params = new URLSearchParams({ symbols: symbols.join(",") });
    const response = await apiFetch<MarketQuotesResponse>(`/api/market/quotes?${params}`);
    return response.quotes;
  },

  async getCandles(
    symbol: string,
    timeframe: string,
    range: string
  ): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol,
      tf: timeframe,
      range,
    });
    const response = await apiFetch<MarketCandlesResponse>(`/api/market/candles?${params}`);
    return response.candles;
  },

  async getMarketClock(): Promise<MarketClock> {
    return apiFetch<MarketClock>("/api/market/clock");
  },

  // Orders (requires auth token)
  async getOrders(token: string): Promise<Order[]> {
    return apiFetch<Order[]>("/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  async placeOrder(
    order: Omit<Order, "id" | "userId" | "status" | "idempotencyKey" | "placedAt" | "filledAt" | "updatedAt">,
    token: string
  ): Promise<Order> {
    return apiFetch<Order>("/api/orders", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(order),
    });
  },

  async cancelOrder(orderId: string, token: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/orders/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};

// SSE Stream for real-time quotes
export function createQuotesStream(
  symbols: string[],
  onMessage: (quotes: Quote[]) => void,
  onError?: (error: Error) => void
): () => void {
  const params = new URLSearchParams({ symbols: symbols.join(",") });

  const eventSource = new EventSource(
    `${API_BASE_URL}/api/market/stream?${params}`
  );

  const handleEvent = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as Quote | { quotes: Quote[] };
      onMessage("quotes" in data ? data.quotes : [data]);
    } catch {
      onError?.(new Error("Failed to parse SSE message"));
    }
  };
  eventSource.addEventListener("snapshot", handleEvent as EventListener);
  eventSource.addEventListener("tick", handleEvent as EventListener);

  eventSource.onerror = () => {
    onError?.(new Error("SSE connection error"));
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

export default api;
