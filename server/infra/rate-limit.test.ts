import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { rateLimit } from "./rate-limit";
import { RedisKeys } from "../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

describe("rateLimit (integration)", () => {
  afterAll(async () => {
    const minute = Math.floor(Date.now() / 60_000).toString();
    await r.del(RedisKeys.ratelimitRestKey("u-rate", minute));
    r.disconnect();
  });

  it("allows up to limit, then rejects with retryAfter", async () => {
    const userId = `u-rate-${Date.now()}`;
    const limit = 10;
    let lastOk = true;
    for (let i = 0; i < limit; i++) {
      const res = await rateLimit(userId, "rest", 1);
      lastOk = res.ok;
    }
    expect(lastOk).toBe(true);

    const over = await rateLimit(userId, "rest", 1);
    expect(over.ok).toBe(false);
    expect(over.retryAfterMs).toBeGreaterThan(0);
  });
});
