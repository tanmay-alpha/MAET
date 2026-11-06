import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resetConfigForTests } from "../../config";
import { closeRedis, getCachedJson, keyExists, setCachedJson, setnxWithTtl } from "./client";

// Port 1 refuses connections: an unreachable Redis like a paused Upstash instance.
const previousUrl = process.env.UPSTASH_REDIS_URL;

beforeAll(async () => {
  await closeRedis();
  process.env.UPSTASH_REDIS_URL = "redis://127.0.0.1:1";
  resetConfigForTests();
});

afterAll(async () => {
  await closeRedis();
  if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_URL;
  else process.env.UPSTASH_REDIS_URL = previousUrl;
  resetConfigForTests();
});

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - started };
}

describe("Redis helpers with an unreachable server", () => {
  it("return a cache miss immediately instead of waiting for reconnects", async () => {
    for (let call = 0; call < 3; call++) {
      const { value, ms } = await timed(() => getCachedJson("cache:test:unreachable"));
      expect(value).toBeUndefined();
      expect(ms).toBeLessThan(50);
    }
  });

  it("skip cache writes immediately", async () => {
    const { ms } = await timed(() => setCachedJson("cache:test:unreachable", { a: 1 }, 60));
    expect(ms).toBeLessThan(50);
  });

  it("fall back to an in-process lock with the same SET NX semantics", async () => {
    const key = `lock:test:${crypto.randomUUID()}`;
    const first = await timed(() => setnxWithTtl(key, "a", 60));
    expect(first).toMatchObject({ value: true });
    expect(first.ms).toBeLessThan(50);
    expect(await setnxWithTtl(key, "b", 60)).toBe(false);
    expect(await keyExists(key)).toBe(true);
    expect(await keyExists(`${key}:other`)).toBe(false);
  });
});
