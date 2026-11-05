import { defineEventHandler, createError, setResponseHeader } from "h3";
import { requireAuth } from "../trpc/auth";
import { getRedis } from "../../data/redis/client";
import { MAX_PAPER_STREAMS_PER_USER, paperStreamSlots } from "../../modules/paper-trading/stream-slots";

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);
  const userId = auth.userId;

  const release = paperStreamSlots.acquire(userId);
  if (!release) {
    throw createError({
      statusCode: 429,
      statusMessage: `At most ${MAX_PAPER_STREAMS_PER_USER} concurrent paper streams per user`,
    });
  }

  let sub: ReturnType<typeof getRedis>;
  try {
    sub = getRedis().duplicate();
  } catch {
    release();
    throw createError({
      statusCode: 503,
      statusMessage: "Realtime notification stream temporarily unavailable. Polling active.",
    });
  }

  const channel = `paper:user:${userId}`;
  const res = event.node.res;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer ?? undefined);
    sub.unsubscribe(channel).catch(() => {});
    sub.quit().catch(() => {});
    release();
  };
  // Registered before any await so a client that disconnects early still frees its slot.
  event.node.req.on("close", cleanup);

  try {
    await sub.subscribe(channel);
  } catch (err) {
    cleanup();
    throw err;
  }
  if (closed) return;

  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache, no-transform");
  setResponseHeader(event, "Connection", "keep-alive");
  setResponseHeader(event, "X-Accel-Buffering", "no");

  sub.on("message", (subChannel, message) => {
    if (subChannel === channel && !res.writableEnded) {
      res.write(`data: ${message}\n\n`);
    }
  });

  res.write(`data: ${JSON.stringify({ type: "CONNECTED", userId, timestamp: new Date().toISOString() })}\n\n`);

  heartbeatTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }
  }, 5000);
});
