import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

export type WorldFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function requestJson(
  fetcher: WorldFetch,
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = Math.min(8_000, Math.max(1, options.timeoutMs ?? 8_000));
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timerController = new AbortController();
  const deadline = sleep(timeoutMs, undefined, { signal: timerController.signal }).then(() => {
    controller.abort();
    void reader?.cancel().catch(() => {});
    throw new Error("Upstream request timed out");
  });
  const request = async () => {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw new Error("Upstream request timed out");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Upstream HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("Upstream payload exceeds size limit");
    }
    if (!response.body) throw new Error("Upstream response has no body");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const part = await reader.read();
        if (controller.signal.aborted) throw new Error("Upstream request timed out");
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new Error("Upstream payload exceeds size limit");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error("Upstream returned invalid JSON");
      }
    } finally {
      reader.releaseLock();
    }
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    timerController.abort();
  }
}

/** Queue only active requests; no background intervals or scheduled refreshes. */
export function createSpacedQueue(
  now: () => number,
  pause: (ms: number) => Promise<void>,
  spacingMs: number,
) {
  let previous: Promise<unknown> = Promise.resolve();
  let nextStart = -Infinity;
  return function enqueue<T>(request: () => Promise<T>): Promise<T> {
    const result = previous.then(async () => {
      const delay = nextStart - now();
      if (delay > 0) await pause(delay);
      try {
        return await request();
      } finally {
        // A slow or timed-out request still occupies the upstream, so the gap starts when it settles.
        nextStart = now() + spacingMs;
      }
    });
    previous = result.catch(() => {});
    return result;
  };
}
