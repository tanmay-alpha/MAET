import type { Tick } from "@shared/types";
import { bus } from "../../infra/bus";

class QuoteStore {
  private quotes = new Map<string, Tick>();
  private off: (() => void) | undefined;

  start(): void {
    if (this.off) return;
    this.off = bus.on("tick", (tick) => {
      this.quotes.set(tick.symbol, tick);
    });
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
  }

  set(tick: Tick): void {
    this.quotes.set(tick.symbol, tick);
  }

  get(symbol: string): Tick | undefined {
    return this.quotes.get(symbol.toUpperCase());
  }

  getMany(symbols: string[]): Tick[] {
    return symbols.flatMap((symbol) => {
      const tick = this.get(symbol);
      return tick ? [tick] : [];
    });
  }
}

export const quoteStore = new QuoteStore();
