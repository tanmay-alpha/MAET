import { describe, it, expect, afterAll } from "bun:test";
import Redis from "ioredis";
import { SseHub } from "./hub";
import { bus } from "../../infra/bus";
import { RedisKeys } from "../../data/redis/keys";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, { lazyConnect: true });

afterAll(async () => {
  // cleanup
  const keys = await r.keys("sse:*");
  if (keys.length) await r.del(...keys);
  r.disconnect();
});

describe("SseHub (integration)", () => {
  it("broadcasts a tick to two connections subscribed to RELIANCE", async () => {
    const hub = new SseHub({ writeQueueTimeoutMs: 200 });
    const a: { events: Array<[string, unknown]> } = { events: [] };
    const b: { events: Array<[string, unknown]> } = { events: [] };
    const send = (s: { events: Array<[string, unknown]> }) => (event: string, data: unknown) => {
      s.events.push([event, data]);
    };
    hub.register("c1", "u1", ["RELIANCE"], send(a), () => {});
    hub.register("c2", "u2", ["RELIANCE"], send(b), () => {});
    const tick = { exchange: "NSE" as const, symbol: "RELIANCE", price: 2500, volume: 1, ts: new Date().toISOString(), source: "yahoo" as const };
    bus.emit("tick", tick);
    await new Promise((res) => setTimeout(res, 50));
    expect(a.events.length).toBeGreaterThanOrEqual(1);
    expect(b.events.length).toBeGreaterThanOrEqual(1);
    expect((a.events[0][1] as any).price).toBe(2500);
    expect((a.events[0][1] as any).symbol).toBe("RELIANCE");
  });
});
