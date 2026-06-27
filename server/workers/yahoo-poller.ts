import { bus } from "../infra/bus";
import { getLogger } from "../infra/logger";
import type { Tick } from "@shared/types";

export type BatchFetch = (symbols: string[]) => Promise<Tick[]>;

export type YahooPollerOptions = {
  intervalMs?: number;
  batchFetch?: BatchFetch;
};

const DEFAULT_INTERVAL_MS = 5_000;

function getLog() {
  try {
    return getLogger().child({ worker: "yahoo-poller" });
  } catch {
    // Fallback when getConfig() env vars are unavailable (e.g., unit tests).
    // Avoid throwing so polling continues; logs are best-effort.
    const noop = {
      warn: (..._args: unknown[]) => {},
      info: (..._args: unknown[]) => {},
      error: (..._args: unknown[]) => {},
      debug: (..._args: unknown[]) => {},
    };
    return noop as unknown as ReturnType<ReturnType<typeof getLogger>["child"]>;
  }
}

// Lazy default batch fetcher: defer the yahoo source import so tests that
// inject their own batchFetch do not require getConfig() env vars to load.
async function defaultBatchFetch(symbols: string[]): Promise<Tick[]> {
  const { getQuote } = await import("../data/sources/yahoo");
  const { resolveMarketSymbol } = await import("../domain/market/symbol");
  const out: Tick[] = [];
  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length > 0) {
      const symbol = queue.shift();
      if (!symbol) return;
      const resolved = resolveMarketSymbol(symbol);
      try {
        out.push(await getQuote(resolved.symbol, resolved.ticker, resolved.exchange));
      } catch (error) {
        getLog().warn({ symbol, err: String(error) }, "yahoo quote fetch failed");
      }
    }
  });
  await Promise.all(workers);
  if (out.length === 0 && symbols.length > 0) {
    throw new Error("all Yahoo quote requests failed");
  }
  return out;
}

export class YahooPoller {
  private symbols: Set<string> = new Set();
  private intervalMs: number;
  private batchFetch: BatchFetch;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshPromise: Promise<void> | undefined;

  constructor(opts: YahooPollerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchFetch = opts.batchFetch ?? defaultBatchFetch;
  }

  subscribe(symbols: string[]): void {
    for (const s of symbols) this.symbols.add(s);
  }

  unsubscribe(symbols: string[]): void {
    for (const s of symbols) this.symbols.delete(s);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  refresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.tick().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async tick(): Promise<void> {
    const symbols = [...this.symbols];
    if (symbols.length === 0) return;

    let ticks: Tick[];
    try {
      ticks = await this.batchFetch(symbols);
    } catch (e) {
      getLog().warn({ err: String(e), symbols }, "yahoo poller: batch fetch failed; will retry next tick");
      return;
    }

    for (const t of ticks) {
      try {
        bus.emit("tick", t);
      } catch (e) {
        getLog().warn({ err: String(e), symbol: t.symbol }, "yahoo poller: bus.emit failed");
      }
    }
  }
}
