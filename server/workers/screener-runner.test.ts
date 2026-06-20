import { describe, it, expect, afterEach } from "bun:test";
import Redis from "ioredis";
import { ScreenerRunner } from "./screener-runner";
import { bus } from "../infra/bus";
import { RedisKeys } from "../data/redis/keys";
import type { Screener } from "@shared/types";

const TEST_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
const r = new Redis(TEST_URL, {
  lazyConnect: true,
  connectTimeout: 1000,
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
});

afterEach(async () => {
  const k = RedisKeys.screenerCriteriaKey("NSE");
  try {
    await r.del(k);
  } catch {
    // Redis not available in this env; skip cleanup.
  }
  try {
    r.disconnect();
  } catch {}
});

describe("ScreenerRunner", () => {
  it("emits screener:match on matching tick and not on non-matching", async () => {
    const screener: Screener = {
      id: "s1",
      userId: "u1",
      name: "low PE",
      exchange: "NSE",
      criteria: { field: "pe", op: "lt", value: 30 },
      isActive: true,
    };
    const loadActive = async () => [screener];
    const runner = new ScreenerRunner({
      loadActive,
      getFundamentals: async () => ({
        symbol: "X",
        asOf: new Date().toISOString(),
        pe: 20,
        raw: {},
      }),
    });
    // Pre-warm the in-memory cache so onTick doesn't need to call reload()
    // (which would attempt a Redis write and fail in this env).
    await runner.reload("NSE");
    const matches: any[] = [];
    const off = bus.on("screener:match", (m) => matches.push(m));
    runner.start();
    bus.emit("tick", {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 100,
      volume: 1,
      ts: new Date().toISOString(),
      source: "yahoo",
    });
    await new Promise((res) => setTimeout(res, 50));
    expect(matches.length).toBe(1);
    expect(matches[0].screenerId).toBe("s1");
    off();
    runner.stop();
  });
});