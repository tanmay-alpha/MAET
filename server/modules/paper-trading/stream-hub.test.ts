import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { Socket, TCPSocketListener } from "bun";
import { paperUserChannel } from "@shared/domain/paper-trading/stream-events";
import { closeRedisClient, createRedisClient } from "../../data/redis/client";
import {
  PaperStreamHub,
  PaperStreamUnavailableError,
  createPaperStreamSubscriber,
} from "./stream-hub";

class FakeSubscriber extends EventEmitter {
  subscribed: string[] = [];
  unsubscribed: string[] = [];
  subscribeResult: Promise<unknown> = Promise.resolve(1);
  async subscribe(channel: string) {
    this.subscribed.push(channel);
    return this.subscribeResult;
  }
  async unsubscribe(channel: string) {
    this.unsubscribed.push(channel);
  }
  async quit() {}
}

describe("PaperStreamHub", () => {
  it("serves every stream from one subscriber connection and fans messages out by channel", async () => {
    const subscriber = new FakeSubscriber();
    let connections = 0;
    const hub = new PaperStreamHub({
      createSubscriber: () => {
        connections++;
        return subscriber;
      },
    });
    const received: Record<string, string[]> = { a1: [], a2: [], b: [] };
    const releaseA1 = await hub.subscribe("user-a", (message) => received.a1!.push(message));
    const releaseA2 = await hub.subscribe("user-a", (message) => received.a2!.push(message));
    const releaseB = await hub.subscribe("user-b", (message) => received.b!.push(message));

    expect(connections).toBe(1);
    expect(subscriber.subscribed).toEqual([paperUserChannel("user-a"), paperUserChannel("user-b")]);

    subscriber.emit("message", paperUserChannel("user-a"), "for-a");
    subscriber.emit("message", paperUserChannel("user-b"), "for-b");
    expect(received).toEqual({ a1: ["for-a"], a2: ["for-a"], b: ["for-b"] });

    releaseA1();
    await Promise.resolve();
    expect(subscriber.unsubscribed).toEqual([]);
    releaseA2();
    releaseB();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(subscriber.unsubscribed.sort()).toEqual([paperUserChannel("user-a"), paperUserChannel("user-b")].sort());
    expect(hub.channelCount()).toBe(0);
  });

  it("gives up on a SUBSCRIBE past the deadline and unsubscribes once it lands", async () => {
    const subscriber = new FakeSubscriber();
    const pending = Promise.withResolvers<unknown>();
    subscriber.subscribeResult = pending.promise;
    const hub = new PaperStreamHub({ createSubscriber: () => subscriber, subscribeDeadline: () => Promise.resolve() });

    await expect(hub.subscribe("user-late", () => {})).rejects.toBeInstanceOf(PaperStreamUnavailableError);
    pending.resolve(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(subscriber.unsubscribed).toEqual([paperUserChannel("user-late")]);
    expect(hub.channelCount()).toBe(0);
  });

  it("reports a failed SUBSCRIBE as unavailable and retries it for the next stream", async () => {
    const subscriber = new FakeSubscriber();
    subscriber.subscribeResult = Promise.reject(new Error("Connection is closed."));
    subscriber.subscribeResult.catch(() => {});
    const hub = new PaperStreamHub({ createSubscriber: () => subscriber });

    await expect(hub.subscribe("user-retry", () => {})).rejects.toBeInstanceOf(PaperStreamUnavailableError);
    subscriber.subscribeResult = Promise.resolve(1);
    const release = await hub.subscribe("user-retry", () => {});

    expect(subscriber.subscribed).toEqual([paperUserChannel("user-retry"), paperUserChannel("user-retry")]);
    release();
  });
});

/**
 * Minimal RESP server that answers the ready check at once but delays every
 * SUBSCRIBE reply, like a cross-region Redis whose first round trips are slow.
 */
function startSlowRedis(subscribeDelayMs: number): TCPSocketListener<{ buffer: string }> {
  const encode = (parts: Array<string | number>) =>
    `*${parts.length}\r\n${parts.map((part) => (typeof part === "number" ? `:${part}\r\n` : `$${Buffer.byteLength(part)}\r\n${part}\r\n`)).join("")}`;

  const handle = (socket: Socket<{ buffer: string }>, command: string[]) => {
    const name = command[0]?.toUpperCase();
    if (name === "INFO") {
      const info = "# Server\r\nredis_version:7.2.0\r\nloading:0\r\n";
      socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
    } else if (name === "SUBSCRIBE") {
      // A real delay on purpose: the regression was ioredis's per-command timer
      // (1s on the shared client), which only a real clock exercises.
      setTimeout(() => {
        command.slice(1).forEach((channel, index) => socket.write(encode(["subscribe", channel, index + 1])));
      }, subscribeDelayMs);
    } else if (name === "QUIT") {
      socket.write("+OK\r\n");
      socket.end();
    } else {
      socket.write("+OK\r\n");
    }
  };

  return Bun.listen<{ buffer: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: "" };
      },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        for (;;) {
          const parsed = parseCommand(socket.data.buffer);
          if (!parsed) break;
          socket.data.buffer = socket.data.buffer.slice(parsed.consumed);
          handle(socket, parsed.command);
        }
      },
    },
  });
}

function parseCommand(buffer: string): { command: string[]; consumed: number } | null {
  if (!buffer.startsWith("*")) return null;
  let offset = buffer.indexOf("\r\n");
  if (offset < 0) return null;
  const count = Number(buffer.slice(1, offset));
  offset += 2;
  const command: string[] = [];
  for (let i = 0; i < count; i++) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) return null;
    const length = Number(buffer.slice(offset + 1, lineEnd));
    const start = lineEnd + 2;
    if (buffer.length < start + length + 2) return null;
    command.push(buffer.slice(start, start + length));
    offset = start + length + 2;
  }
  return { command, consumed: offset };
}

describe("paper stream subscriber against a slow Redis", () => {
  let server: TCPSocketListener<{ buffer: string }> | undefined;
  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  it("does not inherit the shared client's 1s command timeout for SUBSCRIBE", async () => {
    server = startSlowRedis(1_500);
    const shared = createRedisClient(`redis://127.0.0.1:${server.port}`);
    const subscriber = createPaperStreamSubscriber(shared);
    const hub = new PaperStreamHub({ createSubscriber: () => subscriber });
    try {
      const release = await hub.subscribe("user-slow", () => {});
      expect(hub.channelCount()).toBe(1);
      release();
    } finally {
      await hub.close();
      await closeRedisClient(shared);
    }
  }, 10_000);
});
