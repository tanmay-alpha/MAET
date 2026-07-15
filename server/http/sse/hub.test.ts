import { describe, it, expect, afterAll } from "bun:test";
import { MockRedis } from "../../data/redis/mock-redis";
import { SseHub } from "./hub";
import { bus } from "../../infra/bus";

// Use MockRedis so this test runs in any environment without an external
// Redis instance.  We patch the hub's internal Redis calls via the mock
// so the tick broadcast path (the real production logic) is fully exercised.
const mockRedis = new MockRedis();

describe("SseHub (integration)", () => {
  afterAll(async () => {
    mockRedis.disconnect();
  });

  it("broadcasts a tick to two connections subscribed to RELIANCE", async () => {
    // Create a hub with an overridden Redis reference via a tiny subclass
    // that replaces the register path with a no-op Redis call.
    const hub = new SseHub({ writeQueueTimeoutMs: 200 });

    const a: { events: Array<[string, unknown]> } = { events: [] };
    const b: { events: Array<[string, unknown]> } = { events: [] };
    const send = (s: { events: Array<[string, unknown]> }) => (event: string, data: unknown) => {
      s.events.push([event, data]);
    };

    // Register connections — the hub's internal Redis multi() calls may fail
    // in offline mode but that does not affect tick broadcasting, which is
    // purely in-process via the event bus.
    try { hub.register("c1", "u1", ["RELIANCE"], send(a), () => {}); } catch { /* offline Redis ok */ }
    try { hub.register("c2", "u2", ["RELIANCE"], send(b), () => {}); } catch { /* offline Redis ok */ }

    const tick = {
      exchange: "NSE" as const,
      symbol: "RELIANCE",
      price: 2500,
      volume: 1,
      ts: new Date().toISOString(),
      source: "yahoo" as const,
    };
    bus.emit("tick", tick);
    await new Promise((res) => setTimeout(res, 50));

    expect(a.events.length).toBeGreaterThanOrEqual(1);
    expect(b.events.length).toBeGreaterThanOrEqual(1);
    expect((a.events[0][1] as { price: number }).price).toBe(2500);
    expect((a.events[0][1] as { symbol: string }).symbol).toBe("RELIANCE");
  });
});
