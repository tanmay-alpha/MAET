export type HealthCheckStatus = {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version: string;
  checks: {
    database: boolean;
    redis: boolean;
    orchestrator: boolean;
    marketData: boolean;
  };
};

const startedAt = Date.now();
const version = process.env.GIT_SHA ?? "dev";

let databaseStatus = true;
let redisStatus = true;
let orchestratorStatus = true;
let marketDataStatus = true;

export function updateHealthStatus(component: "database" | "redis" | "orchestrator" | "marketData", ok: boolean): void {
  if (component === "database") databaseStatus = ok;
  if (component === "redis") redisStatus = ok;
  if (component === "orchestrator") orchestratorStatus = ok;
  if (component === "marketData") marketDataStatus = ok;
}

export function healthHandler(): HealthCheckStatus {
  const allOk = databaseStatus && redisStatus && orchestratorStatus && marketDataStatus;

  return {
    status: allOk ? "ok" : "degraded",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version,
    checks: {
      database: databaseStatus,
      redis: redisStatus,
      orchestrator: orchestratorStatus,
      marketData: marketDataStatus,
    },
  };
}
