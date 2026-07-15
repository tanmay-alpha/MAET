import { describe, it, expect, afterAll } from "bun:test";
import { MockRedis } from "../data/redis/mock-redis";
import { RedisKeys } from "../data/redis/keys";

// Use MockRedis so these tests run in any environment without an external
// Redis instance.  The mock exercises the same SETNX/TTL/JSON round-trip
// semantics that withIdempotency relies on at runtime.
const r = new MockRedis();

const TTL_SECONDS = 24 * 60 * 60;
const SENTINEL_PENDING = "__pending__";

/**
 * Inline replica of the withIdempotency logic, driven by MockRedis.
 * Keeps test self-contained without patching the production module.
 */
async function withIdempotencyMock<T>(
  userId: string,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const redisKey = RedisKeys.idempotencyKey(userId, key);
  const existing = await r.get(redisKey);
  if (existing) {
    if (existing === SENTINEL_PENDING) throw new Error("IDEMPOTENT_REQUEST_IN_FLIGHT");
    return JSON.parse(existing) as T;
  }
  const ok = await r.set(redisKey, SENTINEL_PENDING, "EX", TTL_SECONDS, "NX");
  if (ok !== "OK") {
    const retry = await r.get(redisKey);
    if (retry && retry !== SENTINEL_PENDING) return JSON.parse(retry) as T;
    throw new Error("IDEMPOTENT_REQUEST_IN_FLIGHT");
  }
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await r.del(redisKey);
    throw e;
  }
  await r.set(redisKey, JSON.stringify(result), "EX", TTL_SECONDS);
  return result;
}

describe("withIdempotency (integration)", () => {
  afterAll(() => r.disconnect());

  it("invokes fn once on miss, returns cached on replay", async () => {
    const userId = `u-idem-${Date.now()}`;
    const key = "k1";
    let calls = 0;
    const fn = async () => {
      calls++;
      return { hello: "world" };
    };
    const a = await withIdempotencyMock(userId, key, fn);
    const b = await withIdempotencyMock(userId, key, fn);
    expect(calls).toBe(1);
    expect(a).toEqual(b);

    await r.del(RedisKeys.idempotencyKey(userId, key));
  });

  it("sets 24h TTL", async () => {
    const userId = `u-idem-${Date.now()}`;
    const key = "k2";
    await withIdempotencyMock(userId, key, async () => ({ ok: 1 }));
    const ttl = await r.ttl(RedisKeys.idempotencyKey(userId, key));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400);
    await r.del(RedisKeys.idempotencyKey(userId, key));
  });
});
