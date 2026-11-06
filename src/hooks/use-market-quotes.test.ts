import { describe, expect, test } from "bun:test";
import { MAX_STREAM_SYMBOLS } from "@shared/types";
import { MarketStreamManager } from "./use-market-quotes";

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  /** 0 CONNECTING, 1 OPEN, 2 CLOSED (the browser "fails" the connection on an HTTP error status). */
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
  symbols(): string[] {
    return new URL(this.url).searchParams.getAll("symbols");
  }
}

function createHarness(options: { probeStatus?: (url: string) => Promise<number> } = {}) {
  const sources: FakeEventSource[] = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const warnings: string[] = [];
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
    probeStatus: options.probeStatus ?? (async () => 503),
    warn: (message) => warnings.push(message),
  });

  const runPendingTimer = (): number => {
    const pending = timers.filter((timer) => !timer.cancelled);
    expect(pending).toHaveLength(1);
    const [timer] = pending;
    timer.cancelled = true;
    timer.fn();
    return timer.ms;
  };
  const pendingTimers = () => timers.filter((timer) => !timer.cancelled).length;

  return { manager, sources, timers, warnings, runPendingTimer, pendingTimers };
}

const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("MarketStreamManager symbol cap", () => {
  test("never requests more than the server cap and keeps the newest subscriber's symbols", () => {
    const { manager, sources, warnings, runPendingTimer } = createHarness();
    const ticker = range("IDX", 120);
    const page = range("PAGE", 50);
    manager.subscribe(ticker, () => {}, () => {});
    manager.subscribe(page, () => {}, () => {});
    runPendingTimer();

    const requested = sources.at(-1)!.symbols();
    expect(requested).toHaveLength(MAX_STREAM_SYMBOLS);
    expect(page.every((symbol) => requested.includes(symbol))).toBe(true);
    expect(warnings).toHaveLength(1);

    manager.subscribe(range("MORE", 5), () => {}, () => {});
    runPendingTimer();
    expect(warnings).toHaveLength(1);
  });
});

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

  test("stops retrying a symbol set the server rejected with 400 until subscriptions change", async () => {
    const probed: string[] = [];
    const { manager, sources, runPendingTimer, pendingTimers } = createHarness({
      probeStatus: async (url) => {
        probed.push(url);
        return 400;
      },
    });
    manager.subscribe(["BAD"], () => {}, () => {});
    runPendingTimer();
    const rejected = sources.at(-1)!;
    rejected.readyState = 2;
    rejected.onerror?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(probed).toEqual([rejected.url]);
    expect(pendingTimers()).toBe(0);

    manager.subscribe(["TCS"], () => {}, () => {});
    runPendingTimer();
    expect(sources).toHaveLength(2);
    expect(sources.at(-1)!.symbols()).toEqual(["BAD", "TCS"]);
  });

  test("keeps backing off when a failed connection is not a client error", async () => {
    const { manager, sources, runPendingTimer } = createHarness({ probeStatus: async () => 503 });
    manager.subscribe(["SBIN"], () => {}, () => {});
    runPendingTimer();
    sources.at(-1)!.readyState = 2;
    sources.at(-1)!.onerror?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(runPendingTimer()).toBe(1_000);
  });
});
