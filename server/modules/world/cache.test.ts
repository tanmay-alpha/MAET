import { describe, expect, it } from "bun:test";
import { createSourceCache } from "./cache";

describe("world lazy source cache", () => {
  it("coalesces refreshes and does not fetch before first read", async () => {
    let now = 0;
    let calls = 0;
    const pending = Promise.withResolvers<number[]>();
    const cache = createSourceCache({
      source: "USGS",
      ttlMs: 100,
      cooldownMs: 50,
      maxAgeMs: 1_000,
      now: () => now,
      load: () => {
        calls++;
        return pending.promise;
      },
    });
    expect(calls).toBe(0);
    const first = cache.read();
    const second = cache.read();
    expect(calls).toBe(1);
    pending.resolve([42]);
    expect((await first).data).toEqual([42]);
    expect((await second).status).toEqual({
      source: "USGS",
      fetchedAt: new Date(0).toISOString(),
      stale: false,
    });
    now = 99;
    expect((await cache.read()).data).toEqual([42]);
    expect(calls).toBe(1);
  });

  it("reports the network cause behind a generic fetch failure", async () => {
    const cause = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" });
    const cache = createSourceCache({
      source: "NASA EONET",
      ttlMs: 100,
      cooldownMs: 50,
      maxAgeMs: 1_000,
      now: () => 0,
      load: async () => {
        throw new TypeError("fetch failed", { cause });
      },
    });
    expect((await cache.read()).status.error).toBe("fetch failed (ETIMEDOUT)");
  });

  it("retains last good data and timestamp during failure cooldown, then recovers", async () => {
    let now = 0;
    let calls = 0;
    const cache = createSourceCache({
      source: "GDELT",
      ttlMs: 100,
      cooldownMs: 50,
      maxAgeMs: 1_000,
      now: () => now,
      load: async () => {
        calls++;
        if (calls === 2) throw new Error("upstream unavailable");
        return [calls];
      },
    });
    await cache.read();
    now = 100;
    const failed = await cache.read();
    expect(failed.data).toEqual([1]);
    expect(failed.status).toEqual({
      source: "GDELT",
      fetchedAt: new Date(0).toISOString(),
      stale: true,
      error: "upstream unavailable",
    });
    now = 149;
    await cache.read();
    expect(calls).toBe(2);
    now = 150;
    const recovered = await cache.read();
    expect(recovered.data).toEqual([3]);
    expect(recovered.status.stale).toBe(false);
    expect(recovered.status.error).toBeUndefined();
  });

  it("reports an initial failure as unavailable rather than a successful empty feed", async () => {
    const cache = createSourceCache<number>({
      source: "NASA EONET",
      ttlMs: 100,
      cooldownMs: 50,
      maxAgeMs: 1_000,
      now: () => 0,
      load: async () => {
        throw new Error("Invalid payload");
      },
    });
    const result = await cache.read();
    expect(result.data).toEqual([]);
    expect(result.status).toEqual({
      source: "NASA EONET",
      fetchedAt: null,
      stale: true,
      error: "Invalid payload",
    });
  });

  it("peeks at the current payload without starting or waiting for a refresh", async () => {
    let calls = 0;
    const pending = Promise.withResolvers<number[]>();
    const cache = createSourceCache({
      source: "GDELT",
      ttlMs: 100,
      cooldownMs: 50,
      maxAgeMs: 1_000,
      now: () => 0,
      load: () => {
        calls++;
        return pending.promise;
      },
    });
    expect(cache.peek()).toEqual({
      data: [],
      status: { source: "GDELT", fetchedAt: null, stale: false },
    });
    expect(calls).toBe(0);
    const read = cache.read();
    expect(cache.peek().data).toEqual([]);
    pending.resolve([7]);
    await read;
    expect(cache.peek()).toEqual({
      data: [7],
      status: { source: "GDELT", fetchedAt: new Date(0).toISOString(), stale: false },
    });
    expect(calls).toBe(1);
  });

  it("stops serving the last good payload once it reaches the source's maximum age", async () => {
    let now = 0;
    let failing = false;
    const cache = createSourceCache({
      source: "NASA EONET",
      ttlMs: 100,
      cooldownMs: 50,
      maxAgeMs: 1_000,
      now: () => now,
      load: async () => {
        if (failing) throw new Error("upstream unavailable");
        return [now];
      },
    });
    await cache.read();
    failing = true;
    now = 999;
    expect(await cache.read()).toEqual({
      data: [0],
      status: {
        source: "NASA EONET",
        fetchedAt: new Date(0).toISOString(),
        stale: true,
        error: "upstream unavailable",
      },
    });
    now = 1_000;
    const expired = cache.peek();
    expect(expired.data).toEqual([]);
    expect(expired.status).toMatchObject({ source: "NASA EONET", fetchedAt: null, stale: true });
    expect(expired.status.error).toContain("upstream unavailable");
    expect(expired.status.error).toContain("1970-01-01 00:00");
    now = 1_048;
    expect((await cache.read()).data).toEqual([]);
    failing = false;
    now = 1_049;
    expect(await cache.read()).toEqual({
      data: [1_049],
      status: { source: "NASA EONET", fetchedAt: new Date(1_049).toISOString(), stale: false },
    });
  });
});
