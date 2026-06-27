import { bus } from "../infra/bus";
import type { Candle, Tick } from "@shared/types";

type Bucket = {
  symbol: string;
  tf: "1m";
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function minuteKey(ts: string): string {
  // YYYY-MM-DDTHH:MM
  return ts.slice(0, 16);
}

export class CandleWriter {
  private buckets = new Map<string, Bucket>();
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
    const key = `${t.symbol}:1m:${minuteKey(t.ts)}`;
    const b = this.buckets.get(key);
    if (!b) {
      this.buckets.set(key, {
        symbol: t.symbol,
        tf: "1m",
        ts: `${minuteKey(t.ts)}:00.000Z`,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: t.volume,
      });
    } else {
      b.high = Math.max(b.high, t.price);
      b.low = Math.min(b.low, t.price);
      b.close = t.price;
      b.volume += t.volume;
    }
  }

  flush(symbol: string, tf: "1m" | "1d"): Candle[] {
    const out: Candle[] = [];
    for (const [k, b] of this.buckets) {
      if (b.symbol === symbol && b.tf === tf) {
        out.push({ ...b });
        this.buckets.delete(k);
      }
    }
    return out;
  }
}
