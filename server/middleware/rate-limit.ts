import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from "h3";
import type Redis from "ioredis";
import { tryAuth } from "../api/trpc/auth";
import { getRedis } from "../data/redis/client";

/**
 * Token-bucket rate limiter for the API surface (per client IP and, when a
 * valid bearer token is present, per user). Redis-backed when the shared
 * client is connected so limits hold across instances; otherwise falls back
 * to an in-process bucket map. SSE `/stream` endpoints are excluded because
 * they hold long-lived connections with their own subscription caps.
 */

export type BucketLimit = { capacity: number; refillPerSec: number };

export type RateLimitConfig = {
  enabled: boolean;
  ip: BucketLimit;
  user: BucketLimit;
};

export type TakeResult = { ok: boolean; retryAfterMs: number };

export interface RateLimitStore {
  take(key: string, limit: BucketLimit, nowMs: number): Promise<TakeResult>;
}

const LIMITED_PREFIXES = ["/api/trpc/", "/api/market/", "/api/backtest/", "/api/paper/"];

export function isRateLimitedPath(pathname: string): boolean {
  if (pathname.endsWith("/stream")) return false;
  return pathname === "/api/trpc" || LIMITED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    enabled: env.RATE_LIMIT_ENABLED !== "false",
    ip: {
      capacity: positiveNumber(env.RATE_LIMIT_IP_CAPACITY, 300),
      refillPerSec: positiveNumber(env.RATE_LIMIT_IP_REFILL_PER_SEC, 5),
    },
    user: {
      capacity: positiveNumber(env.RATE_LIMIT_USER_CAPACITY, 120),
      refillPerSec: positiveNumber(env.RATE_LIMIT_USER_REFILL_PER_SEC, 2),
    },
  };
}

function retryAfterMs(tokens: number, limit: BucketLimit): number {
  return Math.ceil(((1 - tokens) / limit.refillPerSec) * 1000);
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { tokens: number; updatedMs: number }>();

  constructor(private readonly maxKeys = 50_000) {}

  async take(key: string, limit: BucketLimit, nowMs: number): Promise<TakeResult> {
    const existing = this.buckets.get(key);
    const elapsedSec = existing ? Math.max(0, nowMs - existing.updatedMs) / 1000 : 0;
    const tokens = existing
      ? Math.min(limit.capacity, existing.tokens + elapsedSec * limit.refillPerSec)
      : limit.capacity;

    if (!existing && this.buckets.size >= this.maxKeys) this.evictFull(nowMs, limit);

    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedMs: nowMs });
      return { ok: false, retryAfterMs: retryAfterMs(tokens, limit) };
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedMs: nowMs });
    return { ok: true, retryAfterMs: 0 };
  }

  /** Drop buckets that have refilled completely; they carry no state. */
  private evictFull(nowMs: number, limit: BucketLimit): void {
    for (const [key, bucket] of this.buckets) {
      const refilled = bucket.tokens + ((nowMs - bucket.updatedMs) / 1000) * limit.refillPerSec;
      if (refilled >= limit.capacity) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }
}

// KEYS[1] bucket key; ARGV: capacity, refillPerSec, nowMs.
// Returns {allowed (0/1), tokens * 1000}.
const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 't', 'u')
local tokens = tonumber(state[1])
local updated = tonumber(state[2])
if tokens == nil then
  tokens = capacity
else
  tokens = math.min(capacity, tokens + math.max(0, now - updated) / 1000 * rate)
end
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 't', tokens, 'u', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)
return {allowed, math.floor(tokens * 1000)}
`;

/** Uses Redis while the shared client is connected; the memory store otherwise. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly fallback: RateLimitStore = new MemoryRateLimitStore(),
    private readonly redis: () => Redis = getRedis
  ) {}

  async take(key: string, limit: BucketLimit, nowMs: number): Promise<TakeResult> {
    let client: Redis;
    try {
      client = this.redis();
    } catch {
      return this.fallback.take(key, limit, nowMs);
    }
    // Never queue commands behind a reconnecting client: that would add the
    // retry latency to every API request when Redis is down.
    if (client.status !== "ready") return this.fallback.take(key, limit, nowMs);
    try {
      const [allowed, milliTokens] = (await client.eval(
        TOKEN_BUCKET_LUA,
        1,
        `ratelimit:bucket:${key}`,
        limit.capacity,
        limit.refillPerSec,
        nowMs
      )) as [number, number];
      return allowed === 1
        ? { ok: true, retryAfterMs: 0 }
        : { ok: false, retryAfterMs: retryAfterMs(milliTokens / 1000, limit) };
    } catch {
      return this.fallback.take(key, limit, nowMs);
    }
  }
}

/** Client IP: rightmost X-Forwarded-For hop (appended by the platform proxy), else the socket. */
export function clientIp(event: H3Event): string {
  const forwarded = getRequestHeader(event, "x-forwarded-for");
  const hops = forwarded?.split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops?.at(-1) ?? event.node.req.socket?.remoteAddress ?? "unknown";
}

async function defaultResolveUser(event: H3Event): Promise<string | null> {
  if (!getRequestHeader(event, "authorization")) return null;
  return (await tryAuth(event))?.userId ?? null;
}

export type RateLimitMiddlewareOptions = {
  config?: RateLimitConfig;
  store?: RateLimitStore;
  now?: () => number;
  resolveUser?: (event: H3Event) => Promise<string | null>;
};

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const config = options.config ?? rateLimitConfigFromEnv();
  const store = options.store ?? new RedisRateLimitStore();
  const now = options.now ?? Date.now;
  const resolveUser = options.resolveUser ?? defaultResolveUser;

  return defineEventHandler(async (event) => {
    if (!config.enabled || event.method === "OPTIONS") return;
    if (!isRateLimitedPath(getRequestURL(event).pathname)) return;

    const nowMs = now();
    let result = await store.take(`ip:${clientIp(event)}`, config.ip, nowMs);
    if (result.ok) {
      const userId = await resolveUser(event);
      if (userId) result = await store.take(`user:${userId}`, config.user, nowMs);
    }
    if (result.ok) return;

    setResponseHeader(event, "retry-after", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
    throw createError({ statusCode: 429, statusMessage: "Too Many Requests", message: "Rate limit exceeded" });
  });
}

export default createRateLimitMiddleware();
