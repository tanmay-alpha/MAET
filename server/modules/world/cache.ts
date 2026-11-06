import type { SourceStatus, WorldSource } from "../../../shared/world/contracts";

export interface SourceResult<T> {
  data: T[];
  status: SourceStatus;
}

export function createSourceCache<T>(options: {
  source: WorldSource;
  ttlMs: number;
  cooldownMs: number;
  now: () => number;
  load: () => Promise<T[]>;
}) {
  let data: T[] = [];
  let fetchedAt: number | null = null;
  let retryAt = -Infinity;
  let error: string | undefined;
  let inFlight: Promise<void> | undefined;

  async function refresh() {
    try {
      const next = await options.load();
      data = next;
      fetchedAt = options.now();
      retryAt = fetchedAt + options.ttlMs;
      error = undefined;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Upstream request failed";
      retryAt = options.now() + options.cooldownMs;
    }
  }

  /** Current payload without starting a refresh; `stale` means the latest attempt failed. */
  function peek(): SourceResult<T> {
    return {
      data,
      status: {
        source: options.source,
        fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
        stale: error !== undefined,
        ...(error === undefined ? {} : { error }),
      },
    };
  }

  return {
    peek,
    /** Refreshes when the TTL or failure cooldown has elapsed, coalescing concurrent readers. */
    async read(): Promise<SourceResult<T>> {
      if (inFlight) {
        await inFlight;
      } else if (options.now() >= retryAt) {
        const pending = refresh();
        inFlight = pending;
        await pending;
        inFlight = undefined;
      }
      return peek();
    },
  };
}
