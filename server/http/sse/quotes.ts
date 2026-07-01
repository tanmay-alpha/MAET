import { defineEventHandler, getQuery } from "h3";
import { rateLimit } from "../../infra/rate-limit";
import { sseHub } from "./hub";
import { AppError, UpstreamDegradedError } from "@shared/types/errors";

export default defineEventHandler(async (event) => {
  // SSE endpoint doesn't require auth - it's public data
  const userId = "anonymous"; // Using anonymous since SSE data is public quotes
  const q = getQuery(event);
  const symbols = String(q.symbols ?? "").split(",").filter(Boolean);
  if (!symbols.length) throw new AppError("VALIDATION_FAILED", "symbols required");

  const rl = await rateLimit(userId, "sse:subs", 1);
  if (!rl.ok) throw new AppError("RATE_LIMITED", "too many subs", { retryAfterMs: rl.retryAfterMs });

  const connId = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  event.node.res.setHeader("Content-Type", "text/event-stream");
  event.node.res.setHeader("Cache-Control", "no-store");
  event.node.res.setHeader("Connection", "keep-alive");
  event.node.res.flushHeaders();

  const send = (ev: string, data: unknown) => {
    event.node.res.write(`event: ${ev}\n`);
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sseHub.register(connId, userId, symbols, send, () => event.node.res.end());

  const heartbeat = setInterval(() => {
    send("heartbeat", { ts: Date.now() });
  }, 5_000);

  event.node.req.on("close", () => {
    clearInterval(heartbeat);
    sseHub.unregister(connId);
  });

  // Returning undefined keeps the connection open
  return new Promise(() => {});
});