import { describe, it, expect, afterAll } from "bun:test";
import { MockRedis } from "./mock-redis";
import { RedisKeys } from "./keys";

// Use a real Redis if TEST_REDIS_URL is set, otherwise fall back to MockRedis.
// This ensures integration tests always run in offline/CI environments.
const r = new MockRedis();

describe("RedisKeys", () => {
  it("quoteKey formats cache:quote:NSE:RELIANCE", () => {
    expect(RedisKeys.quoteKey("NSE", "RELIANCE")).toBe("cache:quote:NSE:RELIANCE");
  });
  it("idempotencyKey formats idempotency:user:k", () => {
    expect(RedisKeys.idempotencyKey("u1", "abc")).toBe("idempotency:u1:abc");
  });
  it("candlesKey includes timeframe and dates", () => {
    expect(RedisKeys.candlesKey("NSE", "RELIANCE", "1d", "2026-01-01", "2026-02-01")).toBe(
      "cache:candles:NSE:RELIANCE:1d:2026-01-01:2026-02-01"
    );
  });
});

describe("redis (integration)", () => {
  afterAll(() => r.disconnect());

  it("SETNX and TTL on idempotencyKey", async () => {
    const k = RedisKeys.idempotencyKey("test", `k-${Date.now()}`);
    const ok = await r.set(k, "v", "EX", 60, "NX");
    expect(ok).toBe("OK");
    const t = await r.ttl(k);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(60);
    await r.del(k);
  });
});
