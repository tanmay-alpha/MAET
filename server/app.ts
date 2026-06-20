import { createApp as createH3App, eventHandler, toNodeListener, toWebHandler, setResponseHeader, getMethod, getRequestHeader } from "h3";
import healthHandler from "./routes/health.get";

// CORS allow-list. In production, set FRONTEND_ORIGIN to the Vercel URL
// (e.g. https://maet-tanmay-alpha-tanmay-alphas-projects.vercel.app).
// Falls back to allowing Vercel preview + production hosts.
const ALLOWED_ORIGINS = new Set<string>([
  "https://maet.vercel.app",
  "https://maet-tanmay-alpha-tanmay-alphas-projects.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Allow any *.vercel.app preview URL.
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function corsMiddleware() {
  return eventHandler((event) => {
    const origin = getRequestHeader(event, "origin");
    if (origin && originAllowed(origin)) {
      setResponseHeader(event, "access-control-allow-origin", origin);
      setResponseHeader(event, "vary", "Origin");
      setResponseHeader(event, "access-control-allow-credentials", "true");
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
  app.use("/health", eventHandler(() => healthHandler()));
  const fetch = toWebHandler(app);
  return Object.assign(app, { fetch });
}

export const toNodeHandler = toNodeListener;