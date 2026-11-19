import { describe, expect, it } from "bun:test";
import { WorkingOrderSymbols } from "./working-order-symbols";

describe("WorkingOrderSymbols", () => {
  it("matches everything until the first read completes, then only symbols with working orders", () => {
    const registry = new WorkingOrderSymbols();
    expect(registry.has("NSE", "ANY")).toBe(true);
    const apply = registry.beginRead();
    expect(registry.has("NSE", "ANY")).toBe(true);
    apply([{ exchange: "nse", symbol: " tcs " }]);
    expect(registry.has("NSE", "TCS")).toBe(true);
    expect(registry.has("NSE", "ANY")).toBe(false);
  });

  it("keeps an order placed while a read is in flight, even when that read completes without it", () => {
    const registry = new WorkingOrderSymbols();
    registry.beginRead()([]);
    const staleRead = registry.beginRead();
    const release = registry.beginPlacement("NSE", "INFY");
    expect(registry.has("NSE", "INFY")).toBe(true);
    release();
    // The read took its snapshot before the commit.
    staleRead([]);
    expect(registry.has("NSE", "INFY")).toBe(true);
    // A read started after the placement ended saw the commit; its answer is authoritative.
    registry.beginRead()([]);
    expect(registry.has("NSE", "INFY")).toBe(false);
  });

  it("ignores a read that completes after a newer one, and every read in flight across a reset", () => {
    const registry = new WorkingOrderSymbols();
    const older = registry.beginRead();
    const newer = registry.beginRead();
    newer([{ exchange: "NSE", symbol: "SBIN" }]);
    older([]);
    expect(registry.has("NSE", "SBIN")).toBe(true);

    const inFlight = registry.beginRead();
    registry.reset();
    inFlight([]);
    expect(registry.has("NSE", "SBIN")).toBe(true);
    registry.beginRead()([]);
    expect(registry.has("NSE", "SBIN")).toBe(false);
  });

  /**
   * Model: placements pin, commit and release in that order; reads start, take their snapshot of
   * committed working orders at some later point, then complete (possibly out of order); orders
   * end (cancel/fill) at any time. Invariant: a committed working order is never reported absent.
   */
  it("never reports a committed working order absent, for seeded random interleavings", () => {
    let seed = 0x0dde5;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      // The low bits of a power-of-two LCG cycle with a short period; use the high ones.
      return (seed >>> 16) % limit;
    };
    const symbols = ["A", "B", "C", "D", "E"];

    for (let run = 0; run < 200; run++) {
      const registry = new WorkingOrderSymbols();
      const committed = new Map<string, number>();
      const placements: Array<{ symbol: string; release: () => void; committed: boolean }> = [];
      const reads: Array<{ apply: (rows: Array<{ exchange: string; symbol: string }>) => void; rows?: string[] }> = [];

      for (let step = 0; step < 120; step++) {
        const action = random(8);
        if (action === 0) {
          const symbol = symbols[random(symbols.length)]!;
          placements.push({ symbol, release: registry.beginPlacement("NSE", symbol), committed: false });
        } else if (action === 1 && placements.length > 0) {
          const placement = placements[random(placements.length)]!;
          if (!placement.committed && random(4) > 0) {
            placement.committed = true;
            committed.set(placement.symbol, (committed.get(placement.symbol) ?? 0) + 1);
          }
        } else if (action === 2 && placements.length > 0) {
          // A placement ends after its commit (or without one, when it failed).
          placements.splice(random(placements.length), 1)[0]!.release();
        } else if (action === 3) {
          reads.push({ apply: registry.beginRead() });
        } else if (action === 4 && reads.length > 0) {
          const read = reads[random(reads.length)]!;
          read.rows ??= [...committed.keys()];
        } else if (action === 5 && reads.length > 0) {
          const index = random(reads.length);
          const read = reads[index]!;
          if (read.rows) {
            reads.splice(index, 1);
            read.apply(read.rows.map((symbol) => ({ exchange: "NSE", symbol })));
          }
        } else if (action === 6 && committed.size > 0) {
          const symbol = [...committed.keys()][random(committed.size)]!;
          const left = committed.get(symbol)! - 1;
          if (left > 0) committed.set(symbol, left);
          else committed.delete(symbol);
        } else if (action === 7 && random(10) === 0) {
          registry.reset();
        }

        for (const symbol of committed.keys()) {
          expect({ run, step, symbol, has: registry.has("NSE", symbol) }).toEqual({ run, step, symbol, has: true });
        }
      }

      // No leak: once placements are over, a fresh read decides alone.
      for (const placement of placements) placement.release();
      const apply = registry.beginRead();
      apply([...committed.keys()].map((symbol) => ({ exchange: "NSE", symbol })));
      for (const symbol of symbols) expect(registry.has("NSE", symbol)).toBe(committed.has(symbol));
    }
  });
});
