import { bus } from "../infra/bus";
import type { Candle, Tick } from "@shared/types";
import { istDateKey } from "../domain/market/clock";

/** Closed 1m candles kept per symbol (plus the open minute) until flushed. */
export const RETAINED_CLOSED_MINUTES = 30;

type Bucket = Candle & { tf: "1m" };

type SymbolState = {
  /** Minute key (YYYY-MM-DDTHH:MM, UTC) → bucket, in ascending minute order. */
  buckets: Map<string, Bucket>;
  lastTsMs: number;
  /** IST date of `cumulativeVolume`; providers reset the counter each session. */
  volumeDay: string;
  cumulativeVolume: number;
};

function minuteKey(ts: string): string {
  // YYYY-MM-DDTHH:MM
  return ts.slice(0, 16);
}

/**
 * Builds 1-minute candles from ticks. Tick `volume` is the provider's
 * cumulative volume for the day (Angel One and Yahoo both report it that
 * way), so a candle's volume is the increase in that counter.
 */
export class CandleWriter {
  private symbols = new Map<string, SymbolState>();
  private off: (() => void) | undefined;

  start(): void {
    if (this.off) return;
    this.off = bus.on("tick", (t) => this.onTick(t));
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
  }

  onTick(t: Tick): void {
    const tsMs = Date.parse(t.ts);
    if (!Number.isFinite(tsMs)) return;
    const day = istDateKey(new Date(tsMs));
    let state = this.symbols.get(t.symbol);
    if (!state) {
      // Mid-session start: the counter already includes earlier trades that
      // cannot be attributed to any minute we saw, so it only sets the baseline.
      state = { buckets: new Map(), lastTsMs: tsMs, volumeDay: day, cumulativeVolume: t.volume };
      this.symbols.set(t.symbol, state);
    } else if (tsMs < state.lastTsMs) {
      // Out-of-order tick: its price is older than the current close and its
      // counter is behind the baseline.
      return;
    }

    let volumeDelta = 0;
    if (state.volumeDay !== day) {
      // New session observed after a previous one: the counter restarted at 0.
      state.volumeDay = day;
      volumeDelta = t.volume;
      state.cumulativeVolume = t.volume;
    } else if (t.volume > state.cumulativeVolume) {
      volumeDelta = t.volume - state.cumulativeVolume;
      state.cumulativeVolume = t.volume;
    }
    state.lastTsMs = tsMs;

    const key = minuteKey(t.ts);
    const bucket = state.buckets.get(key);
    if (bucket) {
      bucket.high = Math.max(bucket.high, t.price);
      bucket.low = Math.min(bucket.low, t.price);
      bucket.close = t.price;
      bucket.volume += volumeDelta;
      return;
    }

    state.buckets.set(key, {
      symbol: t.symbol,
      tf: "1m",
      ts: `${key}:00.000Z`,
      open: t.price,
      high: t.price,
      low: t.price,
      close: t.price,
      volume: volumeDelta,
    });
    // Ticks arrive in time order (older ones are dropped above), so the
    // first keys are the oldest closed minutes.
    for (const oldest of state.buckets.keys()) {
      if (state.buckets.size <= RETAINED_CLOSED_MINUTES + 1) break;
      state.buckets.delete(oldest);
    }
  }

  /** Removes and returns the retained 1m candles for `symbol`, oldest first. */
  flush(symbol: string): Candle[] {
    const state = this.symbols.get(symbol);
    if (!state) return [];
    const out = [...state.buckets.values()].map((bucket) => ({ ...bucket }));
    state.buckets.clear();
    return out;
  }
}
