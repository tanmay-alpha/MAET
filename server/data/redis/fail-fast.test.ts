import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import { resetConfigForTests } from "../../config";
import {
  closeRedis,
  closeRedisClient,
  createRedisClient,
  getCachedJson,
  keyExists,
  setCachedJson,
  setnxWithTtl,
} from "./client";

// Port 1 refuses connections: an unreachable Redis like a paused Upstash instance.
const previousUrl = process.env.UPSTASH_REDIS_URL;

beforeAll(async () => {
  await closeRedis();
  process.env.UPSTASH_REDIS_URL = "redis://127.0.0.1:1";
  resetConfigForTests();
});

afterAll(async () => {
  await closeRedis();
  if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_URL;
  else process.env.UPSTASH_REDIS_URL = previousUrl;
  resetConfigForTests();
});

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - started };
}

describe("Redis helpers with an unreachable server", () => {
  it("return a cache miss immediately instead of waiting for reconnects", async () => {
    for (let call = 0; call < 3; call++) {
      const { value, ms } = await timed(() => getCachedJson("cache:test:unreachable"));
      expect(value).toBeUndefined();
      expect(ms).toBeLessThan(50);
    }
  });

  it("skip cache writes immediately", async () => {
    const { ms } = await timed(() => setCachedJson("cache:test:unreachable", { a: 1 }, 60));
    expect(ms).toBeLessThan(50);
  });

  it("fall back to an in-process lock with the same SET NX semantics", async () => {
    const key = `lock:test:${crypto.randomUUID()}`;
    const first = await timed(() => setnxWithTtl(key, "a", 60));
    expect(first).toMatchObject({ value: true });
    expect(first.ms).toBeLessThan(50);
    expect(await setnxWithTtl(key, "b", 60)).toBe(false);
    expect(await keyExists(key)).toBe(true);
    expect(await keyExists(`${key}:other`)).toBe(false);
  });
});

/**
 * Minimal RESP server: answers the ready check (INFO) and every other command,
 * until `goSilent()`, after which it keeps the socket open but never replies.
 */
async function fakeRedis(): Promise<{ url: string; goSilent: () => void; close: () => Promise<void> }> {
  let silent = false;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => {
      if (silent) return;
      const text = chunk.toString();
      const commands = text.split("\r\n").filter((line) => line.startsWith("*")).length;
      for (let index = 0; index < commands; index++) {
        socket.write(text.toUpperCase().includes("INFO") ? "$11\r\nloading:0\r\n\r\n" : "$-1\r\n");
      }
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `redis://127.0.0.1:${port}`,
    goSilent: () => {
      silent = true;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    },
  };
}

/** Records reported states; `next()` resolves with the next one reported. */
function stateRecorder() {
  const states: boolean[] = [];
  let waiter: ((ready: boolean) => void) | undefined;
  return {
    states,
    onStateChange: (ready: boolean) => {
      states.push(ready);
      waiter?.(ready);
      waiter = undefined;
    },
    next: () => {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      waiter = resolve;
      return promise;
    },
  };
}

describe("Redis client state", () => {
  it("detects a connection that goes silent while ready and leaves the ready state", async () => {
    const server = await fakeRedis();
    const recorder = stateRecorder();
    const ready = recorder.next();
    const client = createRedisClient(server.url, {
      onStateChange: recorder.onStateChange,
      commandTimeoutMs: 100,
      socketTimeoutMs: 300,
    });
    try {
      expect(await ready).toBe(true);
      server.goSilent();
      const unavailable = recorder.next();
      // events.once() would reject on the "error" the socket timeout emits first.
      const socketClosed = Promise.withResolvers<void>();
      client.once("close", () => socketClosed.resolve());

      await expect(client.get("cache:test:silent")).rejects.toThrow();
      // The socket timeout destroys the dead socket instead of letting every
      // later command wait out its own timeout.
      expect(await unavailable).toBe(false);
      await socketClosed.promise;
      expect(client.status).not.toBe("ready");
    } finally {
      await closeRedisClient(client);
      await server.close();
    }
  }, 5_000);

  it("does not report an outage when a healthy client is closed on shutdown", async () => {
    const server = await fakeRedis();
    const recorder = stateRecorder();
    const ready = recorder.next();
    const client = createRedisClient(server.url, { onStateChange: recorder.onStateChange });
    try {
      expect(await ready).toBe(true);
      await closeRedisClient(client);
      expect(recorder.states).toEqual([true]);
    } finally {
      await server.close();
    }
  }, 5_000);
});
