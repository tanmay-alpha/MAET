import Redis from "ioredis";
import { getConfig } from "../../config";
import { logger } from "../../infra/logger";

// Redis is an accelerator (caches, locks, pub/sub fan-out), never a source of
// truth. When it is unreachable every command must fail at once instead of
// queueing behind reconnect attempts: with the offline queue each request
// waited 0.3-1s+ per command, which production paid while Upstash was down.
const CONNECT_TIMEOUT_MS = 2_000;
const COMMAND_TIMEOUT_MS = 1_000;
// A socket that stops answering while "ready" is destroyed after this, so
// the client leaves the ready state and helpers fall back instead of every
// command waiting out COMMAND_TIMEOUT_MS forever.
const SOCKET_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let client: Redis | undefined;

export type RedisClientOptions = {
  /** Called once per real transition between ready and unavailable. */
  onStateChange?: (ready: boolean, detail?: string) => void;
  commandTimeoutMs?: number;
  socketTimeoutMs?: number;
};

/** Clients being closed on purpose: their final "end" is not an outage. */
const closing = new WeakSet<Redis>();

export function createRedisClient(url: string, options: RedisClientOptions = {}): Redis {
  const created = new Redis(url, {
    enableOfflineQueue: false,
    enableReadyCheck: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
    socketTimeout: options.socketTimeoutMs ?? SOCKET_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    // Keep reconnecting in the background: 0.5s, 1s, 1.5s ... capped at 30s.
    retryStrategy: (attempt) => Math.min(attempt * 500, MAX_RECONNECT_DELAY_MS),
  });
  let lastReady: boolean | undefined;
  const report = (ready: boolean, detail?: string) => {
    if (closing.has(created) || lastReady === ready) return;
    lastReady = ready;
    options.onStateChange?.(ready, detail);
  };
  // Every ioredis instance needs an error listener; without one, connection
  // errors become process-level unhandled events.
  created.on("error", (error: Error) => report(false, error.message));
  created.on("ready", () => report(true));
  created.on("close", () => report(false, "connection closed"));
  return created;
}

/** Closes a client without reporting the deliberate disconnect as an outage. */
export async function closeRedisClient(target: Redis): Promise<void> {
  closing.add(target);
  try {
    await target.quit();
  } catch {
    target.disconnect(false);
  }
}

function logRedisState(ready: boolean, detail?: string, firstReport = false): void {
  // A healthy start is silent; every later transition is logged once.
  if (ready && firstReport) return;
  if (ready) logger.info("redis connection ready");
  else logger.warn({ err: detail }, "redis unavailable; caches and locks fall back to in-process behaviour");
}

export function getRedis(): Redis {
  if (client) return client;
  let reported = false;
  client = createRedisClient(getConfig().redisUrl, {
    onStateChange: (ready, detail) => {
      logRedisState(ready, detail, !reported);
      reported = true;
    },
  });
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
  await closeRedisClient(current);
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
