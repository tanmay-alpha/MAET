import {
  createError,
  defineEventHandler,
  getRequestHeader,
  setResponseHeader,
  type H3Event,
} from "h3";
import type Redis from "ioredis";
import { tryAuth, type AuthContext } from "../api/trpc/auth";
import { getRedis } from "../data/redis/client";
import { getClientIp } from "../infra/client-ip";

/**
 * Token-bucket rate limiter for the API surface (per client IP and, when a
 * valid bearer token is present, per user). The in-process store is the
 * default (single Render instance, no Redis command volume); set
 * RATE_LIMIT_STORE=redis to share buckets across instances. SSE `/stream`
 * endpoints are excluded because they hold long-lived connections with their
 * own subscription caps.
 */

declare module "h3" {
  interface H3EventContext {
    /** Verified bearer-token identity, resolved once by the rate limiter (null = none/invalid). */
    auth?: AuthContext | null;
  }
}

export type BucketLimit = { capacity: number; refillPerSec: number };

export type RateLimitStoreKind = "memory" | "redis";

export type RateLimitConfig = {
  enabled: boolean;
  store: RateLimitStoreKind;
  ip: BucketLimit;
  user: BucketLimit;
};

export type TakeResult = { ok: boolean; retryAfterMs: number };

export interface RateLimitStore {
  take(key: string, limit: BucketLimit, nowMs: number): Promise<TakeResult>;
}

const LIMITED_PREFIXES = ["/api/trpc/", "/api/market/", "/api/paper/", "/api/world/"];

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
    store: env.RATE_LIMIT_STORE === "redis" ? "redis" : "memory",
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

export type MemoryStoreOptions = { maxKeys?: number; evictBatch?: number };

/**
 * In-process buckets in a Map kept in least-recently-used order (each take
 * re-inserts its key). When full, the oldest `evictBatch` keys are dropped in
 * one pass, so eviction cost is amortised instead of scanning per request.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { tokens: number; updatedMs: number }>();
  private readonly maxKeys: number;
  private readonly evictBatch: number;

  constructor({ maxKeys = 50_000, evictBatch }: MemoryStoreOptions = {}) {
    this.maxKeys = maxKeys;
    this.evictBatch = Math.max(1, evictBatch ?? Math.floor(maxKeys / 10));
  }

  get size(): number {
    return this.buckets.size;
  }

  async take(key: string, limit: BucketLimit, nowMs: number): Promise<TakeResult> {
    const existing = this.buckets.get(key);
    let tokens = limit.capacity;
    if (existing) {
      this.buckets.delete(key);
      const elapsedSec = Math.max(0, nowMs - existing.updatedMs) / 1000;
      tokens = Math.min(limit.capacity, existing.tokens + elapsedSec * limit.refillPerSec);
    } else if (this.buckets.size >= this.maxKeys) {
      let remaining = this.evictBatch;
      for (const oldest of this.buckets.keys()) {
        this.buckets.delete(oldest);
        if (--remaining === 0) break;
      }
    }

    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedMs: nowMs });
      return { ok: false, retryAfterMs: retryAfterMs(tokens, limit) };
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedMs: nowMs });
    return { ok: true, retryAfterMs: 0 };
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

/** Shares buckets through Redis while the client is connected; the memory store otherwise. */
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

export function createRateLimitStore(kind: RateLimitStoreKind): RateLimitStore {
  return kind === "redis" ? new RedisRateLimitStore() : new MemoryRateLimitStore();
}

export type RateLimitMiddlewareOptions = {
  config?: RateLimitConfig;
  store?: RateLimitStore;
  now?: () => number;
  /** Verifies the bearer token; defaults to tryAuth. Only called when an Authorization header is present. */
  authenticate?: (event: H3Event) => Promise<AuthContext | null>;
};

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const config = options.config ?? rateLimitConfigFromEnv();
  const store = options.store ?? createRateLimitStore(config.store);
  const now = options.now ?? Date.now;
  const authenticate = options.authenticate ?? tryAuth;

  return defineEventHandler(async (event) => {
    if (!config.enabled || event.method === "OPTIONS") return;
    if (!isRateLimitedPath(event.path.split("?")[0])) return;

    const nowMs = now();
    let result = await store.take(`ip:${getClientIp(event)}`, config.ip, nowMs);
    if (result.ok) {
      // Resolved once here and shared through event.context so the tRPC
      // handler can skip a second JWT verification. If verification itself
      // fails (auth backend outage), leave it unset so the route re-verifies
      // and reports the outage; this request is then limited by IP only.
      event.context.auth = getRequestHeader(event, "authorization")
        ? await authenticate(event).catch(() => undefined)
        : null;
      const userId = event.context.auth?.userId;
      if (userId) result = await store.take(`user:${userId}`, config.user, nowMs);
    }
    if (result.ok) return;

    setResponseHeader(event, "retry-after", Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
    throw createError({ statusCode: 429, statusMessage: "Too Many Requests", message: "Rate limit exceeded" });
  });
}

export default createRateLimitMiddleware();
