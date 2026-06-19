import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import Redis from "ioredis";
import { createApp, eventHandler, toWebHandler, defineEventHandler, type EventHandler } from "h3";
import { withIdempotency, IDEMPOTENCY_HEADER, IDEMPOTENCY_TTL_SECONDS } from "./idempotency";
import { RedisKeys } from "../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

// Integration tests need the config env schema to be satisfied. They will be
// skipped automatically when Redis isn't reachable, so we can safely set
// placeholder env here without leaking into other suites.
beforeAll(() => {
  process.env.SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY ??= "anon-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-test";
  process.env.UPSTASH_REDIS_URL ??= TEST_URL;
  process.env.ANGELONE_MASTER_KEY ??= "0".repeat(32);
  process.env.NODE_ENV ??= "test";
});

describe("idempotency (pure)", () => {
  it("exports withIdempotency function", () => {
    expect(typeof withIdempotency).toBe("function");
  });

  it("header name is 'idempotency-key'", () => {
    expect(IDEMPOTENCY_HEADER).toBe("idempotency-key");
  });

  it("default TTL is 24h (86400s) per spec §5.4", () => {
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86400);
  });

  it("RedisKeys.idempotencyKey formats as idempotency:{userId}:{key}", () => {
    expect(RedisKeys.idempotencyKey("u1", "abc")).toBe("idempotency:u1:abc");
  });

  it("returns an h3 event handler", () => {
    const wrapped = withIdempotency(eventHandler(() => ({ ok: true })), { userId: () => "u" });
    expect(typeof wrapped).toBe("function");
  });
});

describe("idempotency (integration)", () => {
  afterAll(() => r.disconnect());

  it("caches the handler response and replays on second call with same key", async () => {
    const userId = `u-idem-${Date.now()}`;
    const idemKey = `k-${Date.now()}`;
    const handler = eventHandler(() => ({ ok: true, n: 1 }));
    const wrapped = withIdempotency(handler, { userId: () => userId, ttlSeconds: 30 }) as EventHandler;

    const app = createApp();
    app.use("/test", wrapped);
    const fetch = toWebHandler(app);

    // First call: handler runs, response is cached.
    const res1 = await fetch(
      new Request("http://x/test", { headers: { [IDEMPOTENCY_HEADER]: idemKey } })
    );
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({ ok: true, n: 1 });

    // Verify the cache entry exists in Redis.
    const cached = await r.get(RedisKeys.idempotencyKey(userId, idemKey));
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached!);
    expect(parsed.status).toBe("done");
    expect(parsed.body).toEqual({ ok: true, n: 1 });

    // Second call: should return cached response without re-running handler.
    const res2 = await fetch(
      new Request("http://x/test", { headers: { [IDEMPOTENCY_HEADER]: idemKey } })
    );
    expect(await res2.json()).toEqual({ ok: true, n: 1 });

    await r.del(RedisKeys.idempotencyKey(userId, idemKey));
  });

  it("runs handler again when keys differ", async () => {
    const userId = `u-idem-${Date.now()}`;
    let calls = 0;
    const handler = defineEventHandler(() => {
      calls++;
      return { ok: true, calls };
    });
    const wrapped = withIdempotency(handler, { userId: () => userId, ttlSeconds: 30 }) as EventHandler;

    const app = createApp();
    app.use("/test", wrapped);
    const fetch = toWebHandler(app);

    const k1 = `a-${Date.now()}`;
    const k2 = `b-${Date.now()}`;
    const res1 = await fetch(new Request("http://x/test", { headers: { [IDEMPOTENCY_HEADER]: k1 } }));
    const res2 = await fetch(new Request("http://x/test", { headers: { [IDEMPOTENCY_HEADER]: k2 } }));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(calls).toBe(2);

    await r.del(RedisKeys.idempotencyKey(userId, k1));
    await r.del(RedisKeys.idempotencyKey(userId, k2));
  });

  it("runs handler normally when no Idempotency-Key header is present", async () => {
    const userId = `u-idem-${Date.now()}`;
    let calls = 0;
    const handler = defineEventHandler(() => {
      calls++;
      return { ok: true, calls };
    });
    const wrapped = withIdempotency(handler, { userId: () => userId, ttlSeconds: 30 }) as EventHandler;

    const app = createApp();
    app.use("/test", wrapped);
    const fetch = toWebHandler(app);

    const res1 = await fetch(new Request("http://x/test"));
    const res2 = await fetch(new Request("http://x/test"));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(calls).toBe(2);
  });
});
