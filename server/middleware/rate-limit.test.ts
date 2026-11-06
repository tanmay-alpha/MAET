import { describe, expect, it } from "bun:test";
import { createApp, eventHandler, toWebHandler } from "h3";
import type Redis from "ioredis";
import type { AuthContext } from "../api/trpc/auth";
import { corsMiddleware } from "./cors";
import {
  createRateLimitMiddleware,
  createRateLimitStore,
  MemoryRateLimitStore,
  rateLimitConfigFromEnv,
  RedisRateLimitStore,
  type RateLimitConfig,
} from "./rate-limit";

const config: RateLimitConfig = {
  enabled: true,
  store: "memory",
  ip: { capacity: 3, refillPerSec: 0.5 },
  user: { capacity: 2, refillPerSec: 1 },
};

function buildApp(clock: { now: number }, users: Record<string, string> = {}) {
  const app = createApp();
  app.use(corsMiddleware);
  app.use(
    createRateLimitMiddleware({
      config,
      store: new MemoryRateLimitStore(),
      now: () => clock.now,
      authenticate: async (event): Promise<AuthContext | null> => {
        const userId = users[event.headers.get("authorization") ?? ""];
        return userId ? { userId, email: null, role: "user" } : null;
      },
    })
  );
  app.use(eventHandler((event) => ({ ok: true, auth: event.context.auth ?? null })));
  const handler = toWebHandler(app);
  return (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(`http://localhost${path}`, { headers: { "cf-connecting-ip": "203.0.113.7", ...headers } }));
}

describe("rate limit middleware", () => {
  it("returns 429 with Retry-After once the per-IP bucket is empty, then refills", async () => {
    const clock = { now: 1_000_000 };
    const request = buildApp(clock);
    for (let i = 0; i < 3; i++) expect((await request("/api/market/quotes?symbols=TCS")).status).toBe(200);

    const limited = await request("/api/trpc/companies.list?input=%7B%7D");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("2");

    // A different client IP has its own bucket.
    expect((await request("/api/paper/orders", { "cf-connecting-ip": "198.51.100.1" })).status).toBe(200);

    clock.now += 2_000;
    expect((await request("/api/backtest/run")).status).toBe(200);
  });

  it("exposes Retry-After to browsers on cross-origin 429s", async () => {
    const request = buildApp({ now: 0 });
    for (let i = 0; i < 3; i++) await request("/api/trpc/x", { origin: "http://localhost:3000" });
    const limited = await request("/api/trpc/x", { origin: "http://localhost:3000" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-expose-headers")?.toLowerCase()).toContain("retry-after");
  });

  it("keys on cf-connecting-ip, then true-client-ip, then the leftmost X-Forwarded-For entry", async () => {
    const request = buildApp({ now: 0 });
    // Render appends its own proxy hop on the right; it must not be the key.
    for (let i = 0; i < 3; i++) {
      const res = await request("/api/trpc/x", { "cf-connecting-ip": `198.51.100.${i}`, "x-forwarded-for": "10.0.0.1, 10.1.1.1" });
      expect(res.status).toBe(200);
    }

    const viaTrueClient = (ip: string) =>
      request("/api/trpc/x", { "cf-connecting-ip": "", "true-client-ip": ip, "x-forwarded-for": "10.1.1.1" });
    for (let i = 0; i < 3; i++) expect((await viaTrueClient("192.0.2.50")).status).toBe(200);
    expect((await viaTrueClient("192.0.2.50")).status).toBe(429);
    expect((await viaTrueClient("192.0.2.51")).status).toBe(200);

    const viaXff = (left: string) => request("/api/trpc/x", { "cf-connecting-ip": "", "x-forwarded-for": `${left}, 10.1.1.1` });
    for (let i = 0; i < 3; i++) expect((await viaXff("192.0.2.80")).status).toBe(200);
    expect((await viaXff("192.0.2.80")).status).toBe(429);
    expect((await viaXff("192.0.2.81")).status).toBe(200);
  });

  it("groups IPv6 clients by /64", async () => {
    const request = buildApp({ now: 0 });
    for (let i = 0; i < 3; i++) {
      expect((await request("/api/trpc/x", { "cf-connecting-ip": `2001:db8:1:2::${i + 1}` })).status).toBe(200);
    }
    expect((await request("/api/trpc/x", { "cf-connecting-ip": "2001:db8:1:2:ffff::9" })).status).toBe(429);
    expect((await request("/api/trpc/x", { "cf-connecting-ip": "2001:db8:1:3::1" })).status).toBe(200);
  });

  it("enforces the per-user bucket across IPs and shares the auth result via event.context.auth", async () => {
    const request = buildApp({ now: 0 }, { "Bearer a": "user-a" });
    const first = await request("/api/trpc/x", { authorization: "Bearer a", "cf-connecting-ip": "1.1.1.1" });
    expect(first.status).toBe(200);
    expect((await first.json()).auth).toEqual({ userId: "user-a", email: null, role: "user" });
    expect((await request("/api/trpc/x", { authorization: "Bearer a", "cf-connecting-ip": "2.2.2.2" })).status).toBe(200);
    const limited = await request("/api/trpc/x", { authorization: "Bearer a", "cf-connecting-ip": "3.3.3.3" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");

    const anonymous = await request("/api/trpc/x", { "cf-connecting-ip": "4.4.4.4" });
    expect((await anonymous.json()).auth).toBeNull();
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

  it("reads limits from env with defaults; memory store unless RATE_LIMIT_STORE=redis", () => {
    expect(rateLimitConfigFromEnv({})).toEqual({
      enabled: true,
      store: "memory",
      ip: { capacity: 300, refillPerSec: 5 },
      user: { capacity: 120, refillPerSec: 2 },
    });
    expect(
      rateLimitConfigFromEnv({
        RATE_LIMIT_ENABLED: "false",
        RATE_LIMIT_STORE: "redis",
        RATE_LIMIT_IP_CAPACITY: "10",
        RATE_LIMIT_USER_REFILL_PER_SEC: "-1",
      })
    ).toEqual({ enabled: false, store: "redis", ip: { capacity: 10, refillPerSec: 5 }, user: { capacity: 120, refillPerSec: 2 } });
    expect(createRateLimitStore("memory")).toBeInstanceOf(MemoryRateLimitStore);
    expect(createRateLimitStore("redis")).toBeInstanceOf(RedisRateLimitStore);
  });

  it("evicts least-recently-used buckets in batches", async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 4, evictBatch: 2 });
    const limit = { capacity: 1, refillPerSec: 0.001 };
    for (const key of ["a", "b", "c", "d"]) expect((await store.take(key, limit, 0)).ok).toBe(true);
    // Touch "a" so it becomes most recently used; "b" and "c" are now the oldest.
    expect((await store.take("a", limit, 0)).ok).toBe(false);
    expect((await store.take("e", limit, 0)).ok).toBe(true); // evicts b, c
    expect(store.size).toBe(3);
    expect((await store.take("a", limit, 0)).ok).toBe(false);
    expect((await store.take("d", limit, 0)).ok).toBe(false);
    expect((await store.take("b", limit, 0)).ok).toBe(true);
  });

  it("refills each bucket with the limit it was taken with", async () => {
    const store = new MemoryRateLimitStore();
    const slow = { capacity: 1, refillPerSec: 0.1 };
    const fast = { capacity: 1, refillPerSec: 10 };
    await store.take("ip:x", slow, 0);
    await store.take("user:x", fast, 0);
    expect((await store.take("user:x", fast, 200)).ok).toBe(true);
    expect(await store.take("ip:x", slow, 200)).toEqual({ ok: false, retryAfterMs: 9800 });
  });

  it("redis store falls back to memory when Redis is not connected", async () => {
    let evalCalls = 0;
    const fakeRedis = { status: "reconnecting", eval: async () => { evalCalls++; return [1, 0]; } } as unknown as Redis;
    const store = new RedisRateLimitStore(new MemoryRateLimitStore(), () => fakeRedis);
    const limit = { capacity: 1, refillPerSec: 1 };
    expect((await store.take("k", limit, 0)).ok).toBe(true);
    expect(await store.take("k", limit, 0)).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(evalCalls).toBe(0);
  });
});
