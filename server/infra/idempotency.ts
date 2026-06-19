import { defineEventHandler, getRequestHeader, type EventHandler, type H3Event } from "h3";
import { getRedis, setnxWithTtl } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_TTL_SECONDS = 86400;

export type IdempotencyOptions = {
  /**
   * Returns the userId that scopes the idempotency key. If it returns null/undefined,
   * the wrapped handler runs without idempotency protection.
   */
  userId: (event: H3Event) => string | null | undefined;
  ttlSeconds?: number;
};

type CachedEntry =
  | { status: "pending" }
  | { status: "done"; statusCode: number; headers: Record<string, string>; body: unknown };

/**
 * Wraps an h3 event handler with Idempotency-Key semantics (spec §4, §5.4).
 *
 * - Reads `Idempotency-Key` header. If missing, runs the wrapped handler normally.
 * - On miss: `setnxWithTtl("pending" sentinel)` under `idempotency:{userId}:{key}`
 *   with the configured TTL (default 24h), executes the handler, then overwrites
 *   the cache with the final response.
 * - On hit: returns the cached response (status + headers + JSON body) without
 *   re-running the handler.
 *
 * The HTTP-layer (h3) wrapper. The tRPC version in task 30e will mirror this
 * behavior on the tRPC procedure pipeline.
 */
export function withIdempotency(handler: EventHandler, opts: IdempotencyOptions): EventHandler {
  const ttl = opts.ttlSeconds ?? IDEMPOTENCY_TTL_SECONDS;
  return defineEventHandler(async (event) => {
    const rawKey = getRequestHeader(event, IDEMPOTENCY_HEADER);
    if (!rawKey) return handler(event);

    const userId = opts.userId(event);
    if (!userId) return handler(event);

    const cacheKey = RedisKeys.idempotencyKey(userId, rawKey);
    const r = getRedis();

    // First request wins via SETNX with a "pending" sentinel.
    const claimed = await setnxWithTtl(cacheKey, JSON.stringify({ status: "pending" }), ttl);
    if (claimed) {
      const response = await handler(event);
      const entry: CachedEntry = {
        status: "done",
        statusCode: event.node.res.statusCode || 200,
        headers: collectResponseHeaders(event),
        body: response,
      };
      await r.set(cacheKey, JSON.stringify(entry), "EX", ttl);
      return response;
    }

    // Not the first request. Read the cached entry.
    const cached = await r.get(cacheKey);
    if (!cached) {
      // Race: TTL expired between SETNX-fail and GET. Fall through to handler.
      const response = await handler(event);
      const entry: CachedEntry = {
        status: "done",
        statusCode: event.node.res.statusCode || 200,
        headers: collectResponseHeaders(event),
        body: response,
      };
      await r.set(cacheKey, JSON.stringify(entry), "EX", ttl);
      return response;
    }

    let parsed: CachedEntry;
    try {
      parsed = JSON.parse(cached) as CachedEntry;
    } catch {
      return handler(event);
    }
    if (parsed.status === "done") {
      for (const [name, value] of Object.entries(parsed.headers)) {
        event.node.res.setHeader(name, value);
      }
      event.node.res.statusCode = parsed.statusCode;
      return parsed.body;
    }

    // status === "pending" — concurrent in-flight request. Fall back to running
    // the handler; the DB UNIQUE index in the domain layer is the durable backstop.
    return handler(event);
  });
}

function collectResponseHeaders(event: H3Event): Record<string, string> {
  const raw = event.node.res.getHeaders() as Record<string, string | string[] | number | undefined>;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

