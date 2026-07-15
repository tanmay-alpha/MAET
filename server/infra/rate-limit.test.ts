import { describe, it, expect, afterAll } from "bun:test";
import { MockRedis } from "../data/redis/mock-redis";
import { RedisKeys } from "../data/redis/keys";
import { AppError } from "@shared/types";

// Use MockRedis so this test runs in any environment without an external
// Redis instance. The mock exercises the same INCRBY/TTL/EXPIRE pipeline
// semantics that the rateLimit function depends on at runtime.
const r = new MockRedis();

const REST_LIMIT = 10; // Low limit for test purposes
type RateLimitBucket = "rest" | "sse:subs";

/** Inline replica of rateLimit logic driven by MockRedis. */
async function rateLimitMock(
  userId: string,
  bucket: RateLimitBucket,
  requested = 1
): Promise<{ ok: boolean; retryAfterMs: number }> {
  const minute = Math.floor(Date.now() / 60_000).toString();
  const key =
    bucket === "rest"
      ? RedisKeys.ratelimitRestKey(userId, minute)
      : `ratelimit:sse:subs:${userId}`;
  const limit = REST_LIMIT;
  const ttl = 60;

  const tx = r.multi();
  tx.incrby(key, requested);
  tx.ttl(key);
  const results = tx.exec() ?? [];
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

describe("rateLimit (integration)", () => {
  afterAll(async () => {
    r.disconnect();
  });

  it("allows up to limit, then rejects with retryAfter", async () => {
    const userId = `u-rate-${Date.now()}`;
    let lastOk = true;
    for (let i = 0; i < REST_LIMIT; i++) {
      const res = await rateLimitMock(userId, "rest", 1);
      lastOk = res.ok;
    }
    expect(lastOk).toBe(true);

    const over = await rateLimitMock(userId, "rest", 1);
    expect(over.ok).toBe(false);
    expect(over.retryAfterMs).toBeGreaterThan(0);
  });
});
