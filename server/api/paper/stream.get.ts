import { defineEventHandler, createError, setResponseHeader } from "h3";
import { requireAuth } from "../trpc/auth";
import { getRedis } from "../../data/redis/client";

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);
  const userId = auth.userId;

  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache, no-transform");
  setResponseHeader(event, "Connection", "keep-alive");
  setResponseHeader(event, "X-Accel-Buffering", "no");

  let sub: ReturnType<typeof getRedis> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  try {
    const mainRedis = getRedis();
    sub = mainRedis.duplicate();
  } catch (_err) {
    throw createError({
      statusCode: 503,
      statusMessage: "Realtime notification stream temporarily unavailable. Polling active.",
    });
  }

  const channel = `paper:user:${userId}`;

  const res = event.node.res;

  res.write(`data: ${JSON.stringify({ type: "CONNECTED", userId, timestamp: new Date().toISOString() })}\n\n`);

  heartbeatTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }
  }, 20000);

  sub.on("message", (subChannel, message) => {
    if (subChannel === channel && !res.writableEnded) {
      res.write(`data: ${message}\n\n`);
    }
  });

  await sub.subscribe(channel);

  event.node.req.on("close", () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (sub) {
      sub.unsubscribe(channel).catch(() => {});
      sub.quit().catch(() => {});
      sub = null;
    }
  });
});
