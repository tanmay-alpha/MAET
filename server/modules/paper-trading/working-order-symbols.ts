/**
 * Which EXCHANGE:SYMBOL pairs may have a working paper order, so the order matcher can skip
 * the paper_orders query on ticks of every other streamed symbol.
 *
 * Invariant: once an order placement has committed, every later tick of its symbol is
 * matched. The periodic paper-interest read alone cannot give that: an order committed
 * after a read took its snapshot is missing until the next read completes, and a tick in
 * that window would skip a crossing stop. So a placement pins its symbol before its
 * transaction starts and, when it ends, marks it; a mark is only dropped by a read that
 * started after it (and therefore saw the commit). Answers may be stale-true (an order
 * cancelled or filled since), which only costs one query; never stale-false.
 */

function keyOf(exchange: string, symbol: string): string {
  return `${exchange.trim().toUpperCase()}:${symbol.trim().toUpperCase()}`;
}

export class WorkingOrderSymbols {
  /** Keys with a working order in the newest applied read; undefined until a read completes. */
  private known: Set<string> | undefined;
  /** Placements in flight per key (pinned from before their transaction until they end). */
  private readonly pinned = new Map<string, number>();
  /** Key -> number of reads started when it was marked; a read with a higher sequence saw it. */
  private readonly marks = new Map<string, number>();
  private readsStarted = 0;
  private appliedRead = 0;

  /**
   * Whether ticks of this symbol must be matched. True before the first read completes:
   * after a restart nothing is known yet, and existing orders must still see every tick.
   */
  has(exchange: string, symbol: string): boolean {
    if (!this.known) return true;
    const key = keyOf(exchange, symbol);
    return this.known.has(key) || this.pinned.has(key) || this.marks.has(key);
  }

  /**
   * Call before an order placement's transaction starts; call the returned function once
   * it has ended (committed or not). The symbol is matched from now on until a read that
   * started after the release has completed.
   */
  beginPlacement(exchange: string, symbol: string): () => void {
    const key = keyOf(exchange, symbol);
    this.pinned.set(key, (this.pinned.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.marks.set(key, this.readsStarted);
      const count = this.pinned.get(key) ?? 1;
      if (count > 1) this.pinned.set(key, count - 1);
      else this.pinned.delete(key);
    };
  }

  /**
   * Call before querying working orders; call the returned function with the working-order
   * keys the query returned. A read that completes after a newer one was applied is ignored.
   */
  beginRead(): (working: Iterable<{ exchange: string; symbol: string }>) => void {
    const sequence = ++this.readsStarted;
    return (working) => {
      if (sequence < this.appliedRead) return;
      this.appliedRead = sequence;
      this.known = new Set(Array.from(working, (row) => keyOf(row.exchange, row.symbol)));
      for (const [key, markedAt] of this.marks) {
        if (markedAt < sequence) this.marks.delete(key);
      }
    };
  }

  /**
   * Forgets every read and mark (orchestrator stop, tests): everything is matched again until
   * a read started after this call completes; reads already in flight are ignored. In-flight
   * placements stay pinned.
   */
  reset(): void {
    this.known = undefined;
    this.marks.clear();
    this.appliedRead = this.readsStarted + 1;
  }
}

/** Process-wide registry shared by the paper service (placements) and the orchestrator (reads, matcher). */
export const workingOrderSymbols = new WorkingOrderSymbols();
