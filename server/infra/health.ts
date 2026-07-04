import { sql } from "drizzle-orm";

export type HealthCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  uptime: number;
  checks: Record<string, HealthCheck>;
  version: string;
};

const startedAt = Date.now();
const version = process.env.GIT_SHA ?? "dev";
const checks: Record<string, HealthCheck> = {};
let lastDependencyRefresh = 0;
let refreshInFlight: Promise<void> | undefined;

export function supabaseRestProbeUrl(baseUrl: string): string {
  // Supabase's PostgREST root/OpenAPI endpoint requires a secret API key.
  // A zero-row query verifies the project URL, publishable/anon key and REST
  // access without returning company data.
  return `${baseUrl.replace(/\/$/, "")}/rest/v1/companies?select=id&limit=0`;
}

export function dependencyErrorDetail(error: unknown): string {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "object") {
      const value = current as { code?: unknown; cause?: unknown; errors?: unknown[]; message?: unknown };
      const code = typeof value.code === "string" ? value.code : undefined;
      if (code === "28P01") return "authentication failed (28P01)";
      if (code === "3D000") return "database not found (3D000)";
      if (code === "ENOTFOUND") return "database host not found (ENOTFOUND)";
      if (code === "ECONNREFUSED") return "database connection refused (ECONNREFUSED)";
      if (code === "ETIMEDOUT") return "database connection timed out (ETIMEDOUT)";
      if (value.cause) queue.push(value.cause);
      if (Array.isArray(value.errors)) queue.push(...value.errors);
      if (value.message === "timeout") return "database connection timed out";
    }
  }
  return "database query failed; verify the transaction-pooler URI and credentials";
}

export function registerCheck(name: string, ok: boolean, detail?: string): void {
  checks[name] = { name, ok, detail };
}

export function healthHandler(): HealthReport {
  const allOk = Object.values(checks).every((c) => c.ok);
  return {
    status: Object.keys(checks).length === 0 || allOk ? "ok" : "degraded",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    checks,
    version,
  };
}

async function timed<T>(work: Promise<T>, timeoutMs = 3_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function refreshDependencyChecks(force = false): Promise<void> {
  if (!force && Date.now() - lastDependencyRefresh < 30_000) return Promise.resolve();
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const yahoo = timed(fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=5d",
      { headers: { "user-agent": "stock-market-backend/1.0" } }
    )).then((response) => {
      registerCheck("yahoo", response.ok, response.ok ? "reachable" : `HTTP ${response.status}`);
    }).catch((error: Error) => registerCheck("yahoo", false, error.message));

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabase = supabaseUrl && supabaseKey
      ? timed(fetch(supabaseRestProbeUrl(supabaseUrl), {
          headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` },
        })).then((response) => {
          registerCheck("supabase", response.ok, response.ok ? "reachable" : `HTTP ${response.status}`);
        }).catch((error: Error) => registerCheck("supabase", false, error.message))
      : Promise.resolve(registerCheck("supabase", false, "not configured"));

    const redis = process.env.UPSTASH_REDIS_URL
      ? import("../data/redis/client").then(({ getRedis }) => timed(getRedis().ping())).then((reply) => {
          registerCheck("redis", reply === "PONG", reply === "PONG" ? "reachable" : "unexpected response");
        }).catch((error: Error) => registerCheck("redis", false, error.message))
      : Promise.resolve(registerCheck("redis", false, "not configured"));

    const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    const database = databaseUrl
      ? import("../data/drizzle/client")
          .then(({ getDb }) => timed(getDb().execute(sql`select 1`)))
          .then(() => registerCheck("database", true, "reachable"))
          .catch((error: unknown) => registerCheck("database", false, dependencyErrorDetail(error)))
      : Promise.resolve(registerCheck("database", false, "not configured"));

    const brokerConfigured = Boolean(
      process.env.ANGELONE_API_KEY && process.env.ANGELONE_CLIENT_ID && process.env.ANGELONE_TOTP_SECRET
    );
    if (!brokerConfigured) registerCheck("angelone", false, "not configured");

    await Promise.all([yahoo, supabase, redis, database]);
    lastDependencyRefresh = Date.now();
  })().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}
