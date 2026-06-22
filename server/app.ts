import { createApp as createH3App, eventHandler, toNodeListener, toWebHandler, setResponseHeader, getMethod, getRequestHeader } from "h3";

// CORS allow-list. Reads from FRONTEND_ORIGIN env var (comma-separated list of
// exact origins). Falls back to a hard-coded set for local dev. Does NOT match
// arbitrary *.vercel.app — vercel preview URLs are only allowed when explicitly
// added (e.g. for branch previews). credentials=false because auth uses
// Authorization header, not cookies, so there's no CSRF surface from CORS.
const DEFAULT_LOCAL_ORIGINS = ["http://localhost:3000", "http://localhost:5173"];
const allowedOrigins: string[] = (() => {
  const fromEnv = process.env.FRONTEND_ORIGIN?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_LOCAL_ORIGINS;
})();

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function corsMiddleware() {
  return eventHandler((event) => {
    const origin = getRequestHeader(event, "origin");
    if (origin && originAllowed(origin)) {
      setResponseHeader(event, "access-control-allow-origin", origin);
      setResponseHeader(event, "vary", "Origin");
      // credentials=false because auth is JWT in Authorization header, not
      // cookies. Enabling credentials would require an explicit single-origin
      // echo (no wildcard) and CSRF token — out of scope until cookie auth lands.
    }
    // Preflight
    if (getMethod(event) === "OPTIONS") {
      setResponseHeader(event, "access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      setResponseHeader(event, "access-control-allow-headers", "content-type, authorization, x-idempotency-key");
      setResponseHeader(event, "access-control-max-age", "86400");
      event.node.res.statusCode = 204;
      event.node.res.end();
    }
  });
}

export function createApp() {
  const app = createH3App();
  // Apply CORS to all routes first.
  app.use("/", corsMiddleware());
  const fetch = toWebHandler(app);
  return Object.assign(app, { fetch });
}

export const toNodeHandler = toNodeListener;