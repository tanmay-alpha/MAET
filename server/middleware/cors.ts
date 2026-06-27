import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  sendNoContent,
  setResponseHeader,
} from "h3";

const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://maet-pi.vercel.app",
  "https://maet-tanmay-alphas-projects.vercel.app",
  "https://maet-tanmay-alpha-tanmay-alphas-projects.vercel.app",
];

const configuredOrigins = process.env.FRONTEND_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set(configuredOrigins?.length ? configuredOrigins : DEFAULT_ORIGINS);

export const corsMiddleware = defineEventHandler((event) => {
  const origin = getRequestHeader(event, "origin");
  if (origin && allowedOrigins.has(origin)) {
    setResponseHeader(event, "access-control-allow-origin", origin);
    setResponseHeader(event, "vary", "Origin");
  }

  if (getMethod(event) === "OPTIONS") {
    setResponseHeader(event, "access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    setResponseHeader(
      event,
      "access-control-allow-headers",
      "content-type, authorization, x-idempotency-key"
    );
    setResponseHeader(event, "access-control-max-age", 86400);
    return sendNoContent(event, 204);
  }
});

export default corsMiddleware;
