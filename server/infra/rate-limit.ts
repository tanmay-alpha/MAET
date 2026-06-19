import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";
import { AppError } from "@shared/types";

const REST_LIMIT = 120;
const SSE_SUBS_LIMIT = 50;

export type RateLimitBucket = "rest" | "sse:subs";

export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export async function rateLimit(
  userId: string,
  bucket: RateLimitBucket,
  requested = 1
): Promise<RateLimitResult> {
  const r = getRedis();
  const minute = Math.floor(Date.now() / 60_000).toString();
  const key = bucket === "rest" ? RedisKeys.ratelimitRestKey(userId, minute) : `ratelimit:sse:subs:${userId}`;
  const limit = bucket === "rest" ? REST_LIMIT : SSE_SUBS_LIMIT;
  const ttl = 60;

  const tx = r.multi();
  tx.incrby(key, requested);
  tx.ttl(key);
  const results = (await tx.exec()) ?? [];
  const incrRes = results[0]?.[1] as number | null;
  const ttlRes = results[1]?.[1] as number;
  if (incrRes === null) throw new AppError("UPSTREAM_DEGRADED", "rate limit incr returned null");
  const current = incrRes;
  const remainingTtl = ttlRes === -1 ? ttl : ttlRes;

  if (current > limit) {
    return { ok: false, retryAfterMs: Math.max(1, remainingTtl) * 1000 };
  }
  if (ttlRes === -1) {
    await r.expire(key, ttl);
  }
  return { ok: true, retryAfterMs: 0 };
}
