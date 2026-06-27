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
