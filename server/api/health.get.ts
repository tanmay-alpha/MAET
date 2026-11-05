import { defineEventHandler, setResponseHeader } from "h3";
import { healthChecker, type HealthChecker } from "../infra/health";

// Always HTTP 200: Render's healthCheckPath restarts the instance on non-2xx,
// which would not help when an external dependency (Supabase, Redis) is down.
// Dependency failures are reported in the body as `status: "degraded"`.
export function createHealthRoute(checker: HealthChecker) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "content-type", "application/json");
    setResponseHeader(event, "cache-control", "no-store");
    return checker.check();
  });
}

export default createHealthRoute(healthChecker);
