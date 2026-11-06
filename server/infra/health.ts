import { getSqlClient } from "../data/drizzle/client";
import { getRedis } from "../data/redis/client";
import { logger } from "./logger";

export type HealthComponent = "database" | "redis" | "orchestrator" | "marketData";

export type HealthCheckStatus = {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version: string;
  checks: Record<HealthComponent, boolean>;
};

type Probe = () => Promise<unknown>;

export type HealthCheckerOptions = {
  /** Active dependency checks. A probe passes when it resolves within `timeoutMs`. */
  probes: { database: Probe; redis: Probe };
  timeoutMs?: number;
  /** Probe results are reused for this long so frequent health polls don't hammer dependencies. */
  cacheTtlMs?: number;
  now?: () => number;
};

export type HealthChecker = {
  check(): Promise<HealthCheckStatus>;
  setComponentStatus(component: HealthComponent, ok: boolean): void;
};

const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_PROBE_CACHE_TTL_MS = 10_000;

const startedAt = Date.now();
const version = process.env.GIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown";

function createCachedProbe(
  component: "database" | "redis",
  probe: Probe,
  timeoutMs: number,
  cacheTtlMs: number,
  now: () => number,
): () => Promise<boolean> {
  let last: { ok: boolean; at: number } | undefined;
  let inflight: Promise<boolean> | undefined;

  const run = async (): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Executor form on purpose: Render runs Node 20, which lacks Promise.withResolvers.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${component} probe timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    let ok: boolean;
    try {
      // Promise.resolve().then() turns a synchronous throw (e.g. a missing
      // connection string) into a failed probe instead of a failed request.
      await Promise.race([Promise.resolve().then(probe), timeout]);
      ok = true;
    } catch (err) {
      ok = false;
      if (last?.ok !== false) logger.warn({ component, err }, "health probe failed");
    } finally {
      clearTimeout(timer);
    }
    if (ok && last?.ok === false) logger.info({ component }, "health probe recovered");
    last = { ok, at: now() };
    return ok;
  };

  return () => {
    if (last && now() - last.at < cacheTtlMs) return Promise.resolve(last.ok);
    inflight ??= run().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };
}

export function createHealthChecker(options: HealthCheckerOptions): HealthChecker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_PROBE_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const probeDatabase = createCachedProbe("database", options.probes.database, timeoutMs, cacheTtlMs, now);
  const probeRedis = createCachedProbe("redis", options.probes.redis, timeoutMs, cacheTtlMs, now);

  // Push-style status reported by long-running components. Database and Redis
  // are additionally probed on every (uncached) check.
  const reported: Record<HealthComponent, boolean> = {
    database: true,
    redis: true,
    orchestrator: true,
    marketData: true,
  };

  return {
    async check() {
      const [databaseReachable, redisReachable] = await Promise.all([probeDatabase(), probeRedis()]);
      const checks: Record<HealthComponent, boolean> = {
        database: reported.database && databaseReachable,
        redis: reported.redis && redisReachable,
        orchestrator: reported.orchestrator,
        marketData: reported.marketData,
      };
      return {
        status: Object.values(checks).every(Boolean) ? "ok" : "degraded",
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        version,
        checks,
      };
    },
    setComponentStatus(component, ok) {
      reported[component] = ok;
    },
  };
}

export const healthChecker = createHealthChecker({
  probes: {
    database: () => getSqlClient()`select 1`,
    redis: () => getRedis().ping(),
  },
});

export function updateHealthStatus(component: HealthComponent, ok: boolean): void {
  healthChecker.setComponentStatus(component, ok);
}
