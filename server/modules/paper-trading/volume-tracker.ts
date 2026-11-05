const IST_OFFSET_MS = 330 * 60_000;

/** Calendar date of a timestamp in India Standard Time, e.g. "2026-11-05". */
function istTradingDate(ts: string): string {
  return new Date(new Date(ts).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Turns cumulative session volume (as Angel One and Yahoo report it) into volume traded
 * since the previous tick, per instrument. The baseline restarts only when the IST trading
 * date changes; within a session a lower value is a late, out-of-order snapshot and counts
 * as nothing traded without lowering the baseline.
 */
export class CumulativeVolumeTracker {
  private readonly baselines = new Map<string, { volume: number; tradingDate: string }>();

  /** Volume traded since the previous tick, or undefined for an instrument's first tick. */
  traded(key: string, cumulative: number, ts: string): number | undefined {
    const tradingDate = istTradingDate(ts);
    const previous = this.baselines.get(key);
    if (!previous) {
      this.baselines.set(key, { volume: cumulative, tradingDate });
      return undefined;
    }
    if (previous.tradingDate !== tradingDate) {
      this.baselines.set(key, { volume: cumulative, tradingDate });
      return cumulative;
    }
    if (cumulative <= previous.volume) {
      return 0;
    }
    this.baselines.set(key, { volume: cumulative, tradingDate });
    return cumulative - previous.volume;
  }
}
