import { describe, test, expect, afterEach, mock } from "bun:test";
import { connectPaperTradingStream, type SseEvent } from "./paper-sse-client";

describe("Authenticated SSE Client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends Bearer token header on fetch SSE request", async () => {
    let capturedHeader: string | null = null;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: CONNECTED\ndata: {\"userId\":\"user-123\"}\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const events: SseEvent[] = [];
    await connectPaperTradingStream({
      accessToken: "sse-token-test",
      onEvent: (evt) => events.push(evt),
    });

    expect(capturedHeader).toBe("Bearer sse-token-test");
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("CONNECTED");
    expect((events[0].data as Record<string, unknown>).userId).toBe("user-123");
  });

  test("handles partial chunks and multiple frames per chunk", async () => {
    globalThis.fetch = mock(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: ORDER_PLACED\ndata: {\"id\":\"ord"));
          controller.enqueue(new TextEncoder().encode("-1\"}\n\nevent: ORDER_FILLED\ndata: {\"id\":\"ord-1\"}\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const events: SseEvent[] = [];
    await connectPaperTradingStream({
      accessToken: "sse-token-test",
      onEvent: (evt) => events.push(evt),
    });

    expect(events.length).toBe(2);
    expect(events[0].type).toBe("ORDER_PLACED");
    expect((events[0].data as Record<string, unknown>).id).toBe("ord-1");
    expect(events[1].type).toBe("ORDER_FILLED");
  });

  test("handles heartbeat comments without throwing error", async () => {
    let heartbeatCount = 0;
    globalThis.fetch = mock(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    await connectPaperTradingStream({
      accessToken: "sse-token-test",
      onHeartbeat: () => {
        heartbeatCount++;
      },
    });

    expect(heartbeatCount).toBe(1);
  });

  test("supports clean abort without error callback", async () => {
    let errorCalled = false;
    const controller = new AbortController();
    controller.abort();

    await connectPaperTradingStream({
      accessToken: "sse-token-test",
      signal: controller.signal,
      onError: () => {
        errorCalled = true;
      },
    });

    expect(errorCalled).toBe(false);
  });
});
