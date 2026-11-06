import Redis from "ioredis";
import { getConfig } from "../../config";
import { logger } from "../../infra/logger";

// Redis is an accelerator (caches, locks, pub/sub fan-out), never a source of
// truth. When it is unreachable every command must fail at once instead of
// queueing behind reconnect attempts: with the offline queue each request
// waited 0.3-1s+ per command, which production paid while Upstash was down.
const CONNECT_TIMEOUT_MS = 2_000;
const COMMAND_TIMEOUT_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let client: Redis | undefined;
let lastReportedReady: boolean | undefined;

function reportState(ready: boolean, detail?: string): void {
  if (lastReportedReady === ready) return;
  // The first report is only logged when Redis is down; a healthy start is silent.
  if (lastReportedReady !== undefined || !ready) {
    if (ready) logger.info("redis connection ready");
    else logger.warn({ err: detail }, "redis unavailable; caches and locks fall back to in-process behaviour");
  }
  lastReportedReady = ready;
}

export function getRedis(): Redis {
  if (client) return client;
  const cfg = getConfig();
  client = new Redis(cfg.redisUrl, {
    enableOfflineQueue: false,
    enableReadyCheck: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    // Keep reconnecting in the background: 0.5s, 1s, 1.5s ... capped at 30s.
    retryStrategy: (attempt) => Math.min(attempt * 500, MAX_RECONNECT_DELAY_MS),
  });
  // Every ioredis instance needs an error listener; without one, connection
  // errors become process-level unhandled events.
  client.on("error", (error: Error) => reportState(false, error.message));
  client.on("ready", () => reportState(true));
  client.on("end", () => reportState(false, "connection ended"));
  return client;
}

/** The shared client, or undefined when it cannot serve commands right now. */
function readyClient(): Redis | undefined {
  try {
    const current = getRedis();
    return current.status === "ready" ? current : undefined;
  } catch {
    return undefined;
  }
}

// In-process stand-in for SET NX locks while Redis is down: guards against
// duplicate work inside this instance (cross-instance exclusion needs Redis).
const memoryLocks = new Map<string, number>();

function memoryLockHeld(key: string, now: number): boolean {
  const expiresAt = memoryLocks.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt > now) return true;
  memoryLocks.delete(key);
  return false;
}

/**
 * SET key value EX ttl NX. When Redis is unavailable the lock is taken in
 * process memory with the same semantics, so callers keep running.
 */
export async function setnxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const r = readyClient();
  if (r) {
    try {
      return (await r.set(key, value, "EX", ttlSeconds, "NX")) === "OK";
    } catch {
      // Lost the connection mid-command: fall through to the in-process lock.
    }
  }
  const now = Date.now();
  if (memoryLockHeld(key, now)) return false;
  memoryLocks.set(key, now + ttlSeconds * 1000);
  return true;
}

/** EXISTS key; while Redis is unavailable, reports in-process locks from setnxWithTtl. */
export async function keyExists(key: string): Promise<boolean> {
  const r = readyClient();
  if (r) {
    try {
      return (await r.exists(key)) > 0;
    } catch {
      // Fall through to the in-process view.
    }
  }
  return memoryLockHeld(key, Date.now());
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  lastReportedReady = undefined;
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
 * Get a JSON value from Redis. Returns undefined on a miss, a parse failure,
 * or when Redis is unavailable (never throws, never waits for reconnects).
 */
export async function getCachedJson<T>(key: string): Promise<T | undefined> {
  const r = readyClient();
  if (!r) return undefined;
  try {
    const raw = await r.get(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Set a JSON value in Redis with a TTL (in seconds). Skipped when Redis is
 * unavailable: cache writes are best-effort and never fail a request.
 */
export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const r = readyClient();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Best-effort.
  }
}
