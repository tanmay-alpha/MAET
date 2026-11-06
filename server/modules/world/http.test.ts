import { describe, expect, it } from "bun:test";
import { createSpacedQueue, requestJson } from "./http";

describe("world bounded upstream transport", () => {
  it("reads chunked JSON and rejects excessive content-length before reading", async () => {
    expect(
      await requestJson(async () => Response.json({ events: [] }), "https://example.test"),
    ).toEqual({ events: [] });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      requestJson(
        async () => new Response(body, { headers: { "content-length": "200" } }),
        "https://example.test",
        { maxBytes: 100 },
      ),
    ).rejects.toThrow("size limit");
    expect(cancelled).toBe(true);
  });

  it("enforces streaming byte limits even without content-length and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      requestJson(async () => new Response(body), "https://example.test", { maxBytes: 10 }),
    ).rejects.toThrow("size limit");
    expect(cancelled).toBe(true);
  });

  it("bounds both ignored fetch aborts and a stalled response body", async () => {
    let signal: AbortSignal | undefined;
    const pending = Promise.withResolvers<Response>();
    await expect(
      requestJson(
        async (_url, init) => {
          signal = init?.signal as AbortSignal;
          return pending.promise;
        },
        "https://example.test",
        { timeoutMs: 10 },
      ),
    ).rejects.toThrow("timed out");
    expect(signal?.aborted).toBe(true);
    pending.resolve(new Response("{}"));
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      requestJson(async () => new Response(body), "https://example.test", { timeoutMs: 10 }),
    ).rejects.toThrow("timed out");
    expect(cancelled).toBe(true);
  });

  it("rejects HTTP and JSON errors rather than treating them as empty feeds", async () => {
    await expect(
      requestJson(
        async () => new Response("rate limited", { status: 429 }),
        "https://example.test",
      ),
    ).rejects.toThrow("HTTP 429");
    await expect(
      requestJson(async () => new Response("not JSON"), "https://example.test"),
    ).rejects.toThrow("invalid JSON");
  });

  it("serializes across query failures and spaces request starts", async () => {
    let now = 0;
    const starts: number[] = [];
    const blocked = Promise.withResolvers<void>();
    const queue = createSpacedQueue(
      () => now,
      async (ms) => {
        now += ms;
      },
      5_000,
    );
    const first = queue(async () => {
      starts.push(now);
      await blocked.promise;
      throw new Error("failure");
    });
    // Bun's `expect(promise).rejects` blocks until the promise settles, so capture the rejection instead.
    const failure = first.catch((error: unknown) => error);
    const second = queue(async () => {
      starts.push(now);
      return 2;
    });
    const third = queue(async () => {
      starts.push(now);
      return 3;
    });
    await Promise.resolve();
    expect(starts).toEqual([0]);
    blocked.resolve();
    expect(await failure).toEqual(new Error("failure"));
    expect(await second).toBe(2);
    expect(await third).toBe(3);
    expect(starts).toEqual([0, 5_000, 10_000]);
  });

  it("waits the full spacing after a slow request settles, not after it started", async () => {
    let now = 0;
    const starts: number[] = [];
    const queue = createSpacedQueue(
      () => now,
      async (ms) => {
        now += ms;
      },
      5_000,
    );
    const slow = queue(async () => {
      starts.push(now);
      now += 8_000;
      throw new Error("Upstream request timed out");
    });
    const next = queue(async () => {
      starts.push(now);
      return 2;
    });
    expect(await slow.catch((error: unknown) => error)).toEqual(new Error("Upstream request timed out"));
    expect(await next).toBe(2);
    expect(starts).toEqual([0, 13_000]);
  });
});
