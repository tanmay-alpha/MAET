import { defineEventHandler, createError, setResponseHeader, type H3Event } from "h3";
import {
  PAPER_STREAM_CONNECTED_EVENT,
  PAPER_STREAM_HEARTBEAT_EVENT,
  paperStreamFrame,
  parsePaperStreamMessage,
} from "@shared/domain/paper-trading/stream-events";
import { requireAuth } from "../trpc/auth";
import { getRedis } from "../../data/redis/client";
import { MAX_PAPER_STREAMS_PER_USER, paperStreamSlots } from "../../modules/paper-trading/stream-slots";
import { paperStreamHub, type PaperStreamHub } from "../../modules/paper-trading/stream-hub";

const HEARTBEAT_MS = 5_000;

export interface PaperStreamHandlerDeps {
  authenticate: (event: H3Event) => Promise<{ userId: string }>;
  /** Whether Redis can serve commands now; without it there is nothing to relay. */
  redisReady: () => boolean;
  hub: Pick<PaperStreamHub, "subscribe">;
  /** Calls `beat` periodically; returns the cancel function. */
  heartbeat: (beat: () => void) => () => void;
}

function sharedRedisReady(): boolean {
  try {
    return getRedis().status === "ready";
  } catch {
    return false;
  }
}

function intervalHeartbeat(beat: () => void): () => void {
  const timer = setInterval(beat, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

function unavailable() {
  // The client switches to polling on any non-200 answer.
  return createError({
    statusCode: 503,
    statusMessage: "Realtime notification stream temporarily unavailable. Polling active.",
  });
}

/**
 * SSE stream of the user's committed paper-trading changes. Every frame is a
 * named event (see shared/domain/paper-trading/stream-events).
 */
export function createPaperStreamHandler(deps: PaperStreamHandlerDeps) {
  return defineEventHandler(async (event) => {
    const { userId } = await deps.authenticate(event);

    const releaseSlot = paperStreamSlots.acquire(userId);
    if (!releaseSlot) {
      throw createError({
        statusCode: 429,
        statusMessage: `At most ${MAX_PAPER_STREAMS_PER_USER} concurrent paper streams per user`,
      });
    }
    // Answer 503 at once while Redis is down instead of waiting on SUBSCRIBE.
    if (!deps.redisReady()) {
      releaseSlot();
      throw unavailable();
    }

    const res = event.node.res;
    let closed = false;
    let releaseSubscription: (() => void) | undefined;
    let stopHeartbeat: (() => void) | null = null;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      stopHeartbeat?.();
      releaseSubscription?.();
      releaseSlot();
    };
    // Registered before any await so a client that disconnects early still frees its slot.
    event.node.req.on("close", cleanup);

    try {
      releaseSubscription = await deps.hub.subscribe(userId, (message) => {
        const parsed = parsePaperStreamMessage(message);
        if (!parsed || parsed.userId !== userId || res.writableEnded) return;
        res.write(paperStreamFrame(parsed.eventType, parsed));
      });
    } catch {
      cleanup();
      throw unavailable();
    }
    if (closed) {
      releaseSubscription();
      return;
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache, no-transform");
    setResponseHeader(event, "Connection", "keep-alive");
    setResponseHeader(event, "X-Accel-Buffering", "no");

    res.write(paperStreamFrame(PAPER_STREAM_CONNECTED_EVENT, { userId, timestamp: new Date().toISOString() }));
    stopHeartbeat = deps.heartbeat(() => {
      if (!res.writableEnded) {
        res.write(paperStreamFrame(PAPER_STREAM_HEARTBEAT_EVENT, { timestamp: new Date().toISOString() }));
      }
    });
  });
}

export default createPaperStreamHandler({
  authenticate: requireAuth,
  redisReady: sharedRedisReady,
  hub: paperStreamHub,
  heartbeat: intervalHeartbeat,
});
