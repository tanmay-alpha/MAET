import type { SourceStatus, WorldSource } from "../../../shared/world/contracts";

export interface SourceResult<T> {
  data: T[];
  status: SourceStatus;
}

/**
 * fetch() rejects with a bare "fetch failed" and hides the socket error in `cause`;
 * append its code so an unreachable upstream is diagnosable from the API response.
 */
function describeFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return "Upstream request failed";
  const inner = cause.cause as { code?: unknown; message?: unknown } | undefined;
  const detail = typeof inner?.code === "string" ? inner.code : typeof inner?.message === "string" ? inner.message : undefined;
  return detail ? `${cause.message} (${detail})` : cause.message;
}

export function createSourceCache<T>(options: {
  source: WorldSource;
  ttlMs: number;
  cooldownMs: number;
  /** A payload this old is no longer served, even though no newer one could be fetched. */
  maxAgeMs: number;
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
      error = describeFailure(cause);
      retryAt = options.now() + options.cooldownMs;
    }
  }

  /**
   * Current payload without starting a refresh; `stale` means the latest attempt failed.
   * `fetchedAt` dates the data returned, so it is null once an expired payload is withheld.
   */
  function peek(): SourceResult<T> {
    const source = options.source;
    if (fetchedAt !== null && options.now() - fetchedAt >= options.maxAgeMs) {
      const last = new Date(fetchedAt).toISOString().slice(0, 16).replace("T", " ");
      const limit = `${options.maxAgeMs / 3_600_000} h`;
      const reason = `last data from ${last} UTC is older than ${limit}`;
      return {
        data: [],
        status: { source, fetchedAt: null, stale: true, error: error ? `${error}; ${reason}` : reason },
      };
    }
    return {
      data,
      status: {
        source,
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
