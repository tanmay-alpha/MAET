import { describe, expect, test } from "bun:test";
import { MarketStreamManager } from "./use-market-quotes";

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}

function createHarness() {
  const sources: FakeEventSource[] = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const manager = new MarketStreamManager({
    baseUrl: "https://api.example.test",
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    // Upper bound of the jitter window so the schedule is deterministic.
    random: () => 1,
  });

  const runPendingTimer = (): number => {
    const pending = timers.filter((timer) => !timer.cancelled);
    expect(pending).toHaveLength(1);
    const [timer] = pending;
    timer.cancelled = true;
    timer.fn();
    return timer.ms;
  };

  return { manager, sources, timers, runPendingTimer };
}

describe("MarketStreamManager reconnect policy", () => {
  test("backs off exponentially up to 30s while the stream keeps failing", () => {
    const { manager, sources, runPendingTimer } = createHarness();
    manager.subscribe(["RELIANCE"], () => {}, () => {});
    runPendingTimer();
    expect(sources).toHaveLength(1);

    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      sources.at(-1)!.onerror?.();
      delays.push(runPendingTimer());
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(sources).toHaveLength(8);
  });

  test("resets the backoff after a successful open", () => {
    const { manager, sources, runPendingTimer } = createHarness();
    manager.subscribe(["TCS"], () => {}, () => {});
    runPendingTimer();

    sources.at(-1)!.onerror?.();
    runPendingTimer();
    sources.at(-1)!.onerror?.();
    expect(runPendingTimer()).toBe(2_000);

    sources.at(-1)!.onopen?.();
    sources.at(-1)!.onerror?.();
    expect(runPendingTimer()).toBe(1_000);
  });

  test("stops reconnecting once the last subscriber leaves", () => {
    const { manager, sources, runPendingTimer } = createHarness();
    const unsubscribe = manager.subscribe(["INFY"], () => {}, () => {});
    runPendingTimer();
    sources.at(-1)!.onerror?.();
    unsubscribe();
    runPendingTimer();

    expect(sources).toHaveLength(1);
    expect(sources[0].closed).toBe(true);
  });
});
