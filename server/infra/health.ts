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