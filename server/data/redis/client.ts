import Redis from "ioredis";
import { getConfig } from "../../config";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (client) return client;
  const cfg = getConfig();
  client = new Redis(cfg.redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  // Every ioredis instance needs an error listener; callers still receive
  // rejected commands, while transient connection errors no longer become
  // process-level unhandled events.
  client.on("error", () => {});
  return client;
}

export async function setnxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  const result = await r.set(key, value, "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  try {
    await current.quit();
  } catch {
    current.disconnect(false);
  }
}

export const redis = new Proxy({} as Redis, {
  get(_t, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});

// ---------------------------------------------------------------------------
// JSON cache helpers
// ---------------------------------------------------------------------------

/**
 * Get a JSON value from Redis. Returns undefined if the key does not exist
 * or if parsing fails (never throws for cache misses).
 */
export async function getCachedJson<T>(key: string): Promise<T | undefined> {
  try {
    const r = getRedis();
    const raw = await r.get(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Set a JSON value in Redis with a TTL (in seconds).
 */
export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    const r = getRedis();
    await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache writes are best-effort — never fail a request due to cache errors.
  }
}
