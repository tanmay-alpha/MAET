import type { CorporateActionEvent, CorporateActionsResponse } from "@shared/types";
import { getCorporateActions } from "../../data/sources/yahoo";
import { getLogger } from "../../infra/logger";
import { resolveMarketSymbol } from "./symbol";

/** Dividends and splits change a few times a year; one provider read a day is plenty. */
export const CORPORATE_ACTION_TTL_MS = 24 * 60 * 60 * 1000;
/** Upper bound on distinct symbols kept in process memory. */
export const MAX_CACHED_CORPORATE_ACTIONS = 500;

export type CorporateActionServiceDeps = {
  fetchEvents: (ticker: string) => Promise<CorporateActionEvent[]>;
  now: () => number;
};

/**
 * In-process TTL cache over the provider with single-flight refreshes. When a
 * refresh fails, the last good copy is served with `stale: true`; with no copy
 * the error propagates. Nothing is invented on failure.
 */
export function createCorporateActionService(deps: CorporateActionServiceDeps) {
  // Insertion order is refresh order, so the first key is evicted at capacity.
  const cache = new Map<string, { payload: CorporateActionsResponse; fetchedAt: number }>();
  const inflight = new Map<string, Promise<CorporateActionsResponse>>();

  function load(symbolInput: string): Promise<CorporateActionsResponse> {
    const resolved = resolveMarketSymbol(symbolInput);
    const cached = cache.get(resolved.symbol);
    if (cached && deps.now() - cached.fetchedAt < CORPORATE_ACTION_TTL_MS) return Promise.resolve(cached.payload);

    const existing = inflight.get(resolved.symbol);
    if (existing) return existing;

    const request = deps
      .fetchEvents(resolved.ticker)
      .then((events) => {
        const fetchedAt = deps.now();
        const payload: CorporateActionsResponse = {
          symbol: resolved.symbol,
          source: "yahoo",
          asOf: new Date(fetchedAt).toISOString(),
          stale: false,
          events,
        };
        cache.delete(resolved.symbol);
        cache.set(resolved.symbol, { payload, fetchedAt });
        if (cache.size > MAX_CACHED_CORPORATE_ACTIONS) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        return payload;
      })
      .catch((error: unknown) => {
        if (!cached) throw error;
        getLogger().warn(
          { symbol: resolved.symbol, err: error instanceof Error ? error.message : String(error) },
          "corporate actions refresh failed; serving the cached copy"
        );
        return { ...cached.payload, stale: true };
      })
      .finally(() => inflight.delete(resolved.symbol));

    inflight.set(resolved.symbol, request);
    return request;
  }

  return { load };
}

const defaultService = createCorporateActionService({ fetchEvents: getCorporateActions, now: Date.now });

/** Dividends and splits for one symbol, newest first (GET /api/market/corporate-actions). */
export const loadCorporateActions = defaultService.load;
