import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  PAPER_OUTBOX_EVENT_TYPES,
  PAPER_STREAM_CONNECTED_EVENT,
  paperUserChannel,
} from "@shared/domain/paper-trading/stream-events";
import { connectPaperTradingStream, type SseEvent } from "../../../src/lib/paper-sse-client";
import { PaperStreamManager } from "../../../src/lib/paper-stream-manager";
import { PaperStreamHub } from "../../modules/paper-trading/stream-hub";
import { createPaperStreamHandler, type PaperStreamHandlerDeps } from "./stream.get";
import { MAX_PAPER_STREAMS_PER_USER } from "../../modules/paper-trading/stream-slots";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

class FakeSubscriber extends EventEmitter {
  channels: string[] = [];
  subscribeResult: Promise<unknown> = Promise.resolve(1);
  async subscribe(channel: string) {
    this.channels.push(channel);
    return this.subscribeResult;
  }
  async unsubscribe() {}
  async quit() {}
}

function fakeEvent() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    written: [] as string[],
    setHeader() {},
    getHeader() {
      return undefined;
    },
    write(chunk: string) {
      this.written.push(chunk);
      return true;
    },
  });
  return { event: { path: "/api/paper/stream", context: {}, node: { req, res } }, req, res };
}

type Handler = (event: unknown) => Promise<unknown>;

function handlerFor(userId: string, overrides: Partial<PaperStreamHandlerDeps> = {}) {
  const subscriber = new FakeSubscriber();
  const beats: Array<() => void> = [];
  const handler = createPaperStreamHandler({
    authenticate: async () => ({ userId }),
    redisReady: () => true,
    hub: new PaperStreamHub({ createSubscriber: () => subscriber }),
    heartbeat: (beat) => {
      beats.push(beat);
      return () => {};
    },
    ...overrides,
  }) as unknown as Handler;
  return { handler, subscriber, beat: () => beats.forEach((beat) => beat()) };
}

/** Opens the real route against a fake Redis subscriber and returns its frames so far. */
async function openStream(userId: string) {
  const { handler, subscriber, beat } = handlerFor(userId);
  const { event, req, res } = fakeEvent();
  await handler(event);
  return { subscriber, beat, req, res };
}

function outboxMessage(userId: string, eventType: string) {
  return JSON.stringify({
    id: crypto.randomUUID(),
    userId,
    generation: 1,
    eventType,
    aggregateType: "PaperOrder",
    aggregateId: "order-1",
    payload: { orderId: "order-1" },
    publishedAt: new Date().toISOString(),
  });
}

/** Feeds the server's bytes to the browser's SSE parser. */
async function parseWithClient(frames: string[]) {
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    )) as unknown as typeof fetch;
  const events: SseEvent[] = [];
  let heartbeats = 0;
  await connectPaperTradingStream({
    accessToken: "token",
    onEvent: (event) => events.push(event),
    onHeartbeat: () => heartbeats++,
  });
  return { events, heartbeats };
}

describe("GET /api/paper/stream wire contract", () => {
  it("writes named frames that the browser client parses into CONNECTED, outbox events and heartbeats", async () => {
    const userId = crypto.randomUUID();
    const { subscriber, beat, res } = await openStream(userId);
    const channel = paperUserChannel(userId);
    expect(subscriber.channels).toEqual([channel]);

    subscriber.emit("message", channel, outboxMessage(userId, "PAPER_ORDER_FILLED"));
    // Messages for other users' channels and unknown event types are never relayed.
    subscriber.emit("message", paperUserChannel(crypto.randomUUID()), outboxMessage(userId, "PAPER_ORDER_ACCEPTED"));
    subscriber.emit("message", channel, outboxMessage(userId, "SOMETHING_ELSE"));
    subscriber.emit("message", channel, "not json");
    beat();

    const { events, heartbeats } = await parseWithClient(res.written);

    expect(events.map((event) => event.type)).toEqual([PAPER_STREAM_CONNECTED_EVENT, "PAPER_ORDER_FILLED"]);
    expect(events[0]!.data).toMatchObject({ userId });
    expect(events[1]!.data).toMatchObject({ userId, eventType: "PAPER_ORDER_FILLED", aggregateId: "order-1" });
    expect(heartbeats).toBe(1);
  });

  it("marks the shared browser stream connected and refetches state for every outbox event type", async () => {
    const userId = crypto.randomUUID();
    const { subscriber, res } = await openStream(userId);
    for (const eventType of PAPER_OUTBOX_EVENT_TYPES) {
      subscriber.emit("message", paperUserChannel(userId), outboxMessage(userId, eventType));
    }

    const statuses: boolean[] = [];
    let invalidations = 0;
    const allInvalidated = Promise.withResolvers<void>();
    const manager = new PaperStreamManager({
      getToken: async () => "token",
      watchAuth: () => () => {},
      connect: async (options) => {
        globalThis.fetch = (async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (const frame of res.written) controller.enqueue(new TextEncoder().encode(frame));
                // Keep the stream open: a closed stream reports an error and drops the status.
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream" } }
          )) as unknown as typeof fetch;
        await connectPaperTradingStream(options);
      },
      schedule: () => () => {},
      random: () => 1,
    });
    const unsubscribe = manager.subscribe({
      queryClient: {
        invalidateQueries: async () => {
          if (++invalidations === PAPER_OUTBOX_EVENT_TYPES.length) allInvalidated.resolve();
        },
      },
      onStatusChange: (connected) => statuses.push(connected),
    });

    await allInvalidated.promise;

    expect(statuses.at(-1)).toBe(true);
    expect(invalidations).toBe(PAPER_OUTBOX_EVENT_TYPES.length);
    unsubscribe();
  });
});

describe("GET /api/paper/stream without a working Redis", () => {
  it("answers 503 at once while Redis is not ready, and frees the stream slot", async () => {
    const { handler, subscriber } = handlerFor(crypto.randomUUID(), { redisReady: () => false });
    // More attempts than the per-user stream cap: each must free its slot (503, never 429).
    for (let attempt = 0; attempt < MAX_PAPER_STREAMS_PER_USER + 1; attempt++) {
      await expect(handler(fakeEvent().event)).rejects.toMatchObject({ statusCode: 503 });
    }
    expect(subscriber.channels).toEqual([]);
  });

  it("maps a failed SUBSCRIBE to 503 instead of 500", async () => {
    const subscriber = new FakeSubscriber();
    subscriber.subscribeResult = Promise.reject(new Error("Connection is closed."));
    subscriber.subscribeResult.catch(() => {});
    const { handler } = handlerFor(crypto.randomUUID(), {
      hub: new PaperStreamHub({ createSubscriber: () => subscriber }),
    });
    const { event, res } = fakeEvent();

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 503 });
    expect(res.written).toEqual([]);
  });

  it("maps a SUBSCRIBE that outlasts the subscribe deadline to 503", async () => {
    const subscriber = new FakeSubscriber();
    subscriber.subscribeResult = Promise.withResolvers<unknown>().promise;
    const { handler } = handlerFor(crypto.randomUUID(), {
      hub: new PaperStreamHub({ createSubscriber: () => subscriber, subscribeDeadline: () => Promise.resolve() }),
    });

    await expect(handler(fakeEvent().event)).rejects.toMatchObject({ statusCode: 503 });
  });
});
