import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { RedisKeys } from "./keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

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
