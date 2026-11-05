import { createError, defineEventHandler, getRequestHeader } from "h3";

export const MAX_API_BODY_BYTES = 256 * 1024;

/**
 * Rejects /api requests whose declared body exceeds MAX_API_BODY_BYTES with
 * 413 before any handler parses JSON. This bounds the size of payloads zod has
 * to validate (oversized collections) and the memory spent buffering them.
 * Requests that stream a body without Content-Length (chunked) are rejected
 * too, since their size cannot be checked up front; browsers and the tRPC
 * client always send Content-Length for JSON bodies.
 */
export const bodyLimitMiddleware = defineEventHandler((event) => {
  if (!event.path.startsWith("/api/")) return;
  const contentLength = getRequestHeader(event, "content-length");
  if (contentLength === undefined) {
    if (getRequestHeader(event, "transfer-encoding")?.toLowerCase().includes("chunked")) {
      throw createError({ statusCode: 411, statusMessage: "Length Required" });
    }
    return;
  }
  const bytes = Number(contentLength);
  if (!Number.isFinite(bytes) || bytes > MAX_API_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload Too Large" });
  }
});

export default bodyLimitMiddleware;
