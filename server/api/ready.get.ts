import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { healthChecker, type HealthChecker } from "../infra/health";

// Readiness, unlike /api/health (liveness, always 200 so Render does not restart
// an instance over an external outage), answers 503 unless every dependency the
// product needs is reachable. Release gates and smoke tests use this route; the
// body is the same health document, so the failing component is named.
export function createReadyRoute(checker: HealthChecker) {
  return defineEventHandler(async (event) => {
    const body = await checker.check();
    setResponseHeader(event, "content-type", "application/json");
    setResponseHeader(event, "cache-control", "no-store");
    setResponseStatus(event, body.status === "ok" ? 200 : 503);
    return body;
  });
}

export default createReadyRoute(healthChecker);
