import { describe, expect, it } from "bun:test";
import { createApp, eventHandler, toWebHandler } from "h3";
import type Redis from "ioredis";
import {
  createRateLimitMiddleware,
  MemoryRateLimitStore,
  rateLimitConfigFromEnv,
  RedisRateLimitStore,
  type RateLimitConfig,
} from "./rate-limit";

const config: RateLimitConfig = {
  enabled: true,
  ip: { capacity: 3, refillPerSec: 0.5 },
  user: { capacity: 2, refillPerSec: 1 },
};

function buildApp(clock: { now: number }, users: Record<string, string> = {}) {
  const app = createApp();
  app.use(
    createRateLimitMiddleware({
      config,
      store: new MemoryRateLimitStore(),
      now: () => clock.now,
      resolveUser: async (event) => users[event.headers.get("authorization") ?? ""] ?? null,
    })
  );
  app.use(eventHandler(() => ({ ok: true })));
  const handler = toWebHandler(app);
  return (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": "203.0.113.7", ...headers } }));
}

describe("rate limit middleware", () => {
  it("returns 429 with Retry-After once the per-IP bucket is empty, then refills", async () => {
    const clock = { now: 1_000_000 };
    const request = buildApp(clock);
    for (let i = 0; i < 3; i++) expect((await request("/api/market/quotes")).status).toBe(200);

    const limited = await request("/api/trpc/companies.list");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("2");

    // A different client IP has its own bucket.
    expect((await request("/api/paper/orders", { "x-forwarded-for": "198.51.100.1" })).status).toBe(200);

    clock.now += 2_000;
    expect((await request("/api/backtest/run")).status).toBe(200);
  });

  it("uses the rightmost X-Forwarded-For hop so clients cannot rotate spoofed IPs", async () => {
    const request = buildApp({ now: 0 });
    for (let i = 0; i < 3; i++) {
      expect((await request("/api/trpc/x", { "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` })).status).toBe(200);
    }
    expect((await request("/api/trpc/x", { "x-forwarded-for": "10.9.9.9, 203.0.113.9" })).status).toBe(429);
  });

  it("enforces the per-user bucket across IPs", async () => {
    const request = buildApp({ now: 0 }, { "Bearer a": "user-a" });
    expect((await request("/api/trpc/x", { authorization: "Bearer a", "x-forwarded-for": "1.1.1.1" })).status).toBe(200);
    expect((await request("/api/trpc/x", { authorization: "Bearer a", "x-forwarded-for": "2.2.2.2" })).status).toBe(200);
    const limited = await request("/api/trpc/x", { authorization: "Bearer a", "x-forwarded-for": "3.3.3.3" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
  });

  it("never limits health checks, SSE streams or unrelated routes", async () => {
    const request = buildApp({ now: 0 });
    for (let i = 0; i < 10; i++) {
      expect((await request("/api/health")).status).toBe(200);
      expect((await request("/health")).status).toBe(200);
      expect((await request("/api/market/stream?symbols=TCS")).status).toBe(200);
      expect((await request("/api/paper/stream")).status).toBe(200);
    }
  });

  it("reads limits from env with defaults", () => {
    expect(rateLimitConfigFromEnv({})).toEqual({
      enabled: true,
      ip: { capacity: 300, refillPerSec: 5 },
      user: { capacity: 120, refillPerSec: 2 },
    });
    expect(
      rateLimitConfigFromEnv({ RATE_LIMIT_ENABLED: "false", RATE_LIMIT_IP_CAPACITY: "10", RATE_LIMIT_USER_REFILL_PER_SEC: "-1" })
    ).toEqual({ enabled: false, ip: { capacity: 10, refillPerSec: 5 }, user: { capacity: 120, refillPerSec: 2 } });
  });

  it("falls back to memory when Redis is not connected", async () => {
    let evalCalls = 0;
    const fakeRedis = { status: "reconnecting", eval: async () => { evalCalls++; return [1, 0]; } } as unknown as Redis;
    const store = new RedisRateLimitStore(new MemoryRateLimitStore(), () => fakeRedis);
    const limit = { capacity: 1, refillPerSec: 1 };
    expect((await store.take("k", limit, 0)).ok).toBe(true);
    expect(await store.take("k", limit, 0)).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(evalCalls).toBe(0);
  });
});
