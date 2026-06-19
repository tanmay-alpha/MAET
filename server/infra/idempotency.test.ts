import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { withIdempotency } from "./idempotency";
import { RedisKeys } from "../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

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
    const a = await withIdempotency(userId, key, fn);
    const b = await withIdempotency(userId, key, fn);
    expect(calls).toBe(1);
    expect(a).toEqual(b);

    await r.del(RedisKeys.idempotencyKey(userId, key));
  });

  it("sets 24h TTL", async () => {
    const userId = `u-idem-${Date.now()}`;
    const key = "k2";
    await withIdempotency(userId, key, async () => ({ ok: 1 }));
    const ttl = await r.ttl(RedisKeys.idempotencyKey(userId, key));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400);
    await r.del(RedisKeys.idempotencyKey(userId, key));
  });
});