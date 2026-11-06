import { describe, expect, test } from "bun:test";
import { PaperStreamManager, type PaperStreamSubscriber } from "./paper-stream-manager";
import type { ConnectPaperTradingStreamOptions } from "./paper-sse-client";

function createHarness(initialToken: string | null = "token-1") {
  let token = initialToken;
  const authListeners = new Set<() => void>();
  const connections: Array<{ options: ConnectPaperTradingStreamOptions }> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const manager = new PaperStreamManager({
    getToken: async () => token,
    watchAuth: (onChange) => {
      authListeners.add(onChange);
      return () => authListeners.delete(onChange);
    },
    connect: (options) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      connections.push({ options });
      options.signal?.addEventListener("abort", () => resolve(), { once: true });
      return promise;
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    random: () => 1,
  });

  const runPendingTimer = async (): Promise<number> => {
    const pending = timers.filter((timer) => !timer.cancelled);
    expect(pending).toHaveLength(1);
    const [timer] = pending;
    timer.cancelled = true;
    timer.fn();
    await flush();
    return timer.ms;
  };

  // Simulates another tab signing in/out or refreshing the session.
  const changeSession = async (next: string | null) => {
    token = next;
    authListeners.forEach((listener) => listener());
    await flush();
  };

  return { manager, connections, timers, runPendingTimer, changeSession, authListeners };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function subscriber(invalidations: unknown[][], client = { invalidateQueries: (...args: unknown[]) => { invalidations.push(args); return Promise.resolve(); } }) {
  const statuses: boolean[] = [];
  const sub: PaperStreamSubscriber = { queryClient: client, onStatusChange: (connected) => statuses.push(connected) };
  return { sub, statuses, client };
}

describe("PaperStreamManager", () => {
  test("shares one connection across every consumer", async () => {
    const { manager, connections } = createHarness();
    const invalidations: unknown[][] = [];
    const first = subscriber(invalidations);
    manager.subscribe(first.sub);
    manager.subscribe(subscriber(invalidations, first.client).sub);
    manager.subscribe(subscriber(invalidations, first.client).sub);
    await flush();

    expect(connections).toHaveLength(1);

    connections[0].options.onEvent?.({ type: "CONNECTED", data: {} });
    invalidations.length = 0;
    connections[0].options.onEvent?.({ type: "PAPER_ORDER_FILLED", data: {} });

    expect(first.statuses.at(-1)).toBe(true);
    // One invalidation per QueryClient, not per consumer.
    expect(invalidations).toEqual([[{ queryKey: ["paperTrading"] }]]);
  });

  test("refetches the account each time the server confirms a (re)connected subscription", async () => {
    const { manager, connections, runPendingTimer } = createHarness();
    const invalidations: unknown[][] = [];
    manager.subscribe(subscriber(invalidations).sub);
    await flush();

    // Changes committed before the first subscription or while the stream was down
    // were never announced on it, so the stream cannot be trusted until state is reloaded.
    connections[0].options.onEvent?.({ type: "CONNECTED", data: {} });
    expect(invalidations).toEqual([[{ queryKey: ["paperTrading"] }]]);

    connections[0].options.onError?.(new Error("dropped"));
    await runPendingTimer();
    expect(invalidations).toHaveLength(1);
    connections[1].options.onEvent?.({ type: "CONNECTED", data: {} });
    expect(invalidations).toEqual([[{ queryKey: ["paperTrading"] }], [{ queryKey: ["paperTrading"] }]]);
  });

  test("closes the connection after the last consumer unsubscribes", async () => {
    const { manager, connections, runPendingTimer } = createHarness();
    const a = manager.subscribe(subscriber([]).sub);
    const b = manager.subscribe(subscriber([]).sub);
    await flush();

    a();
    b();
    await runPendingTimer();

    expect(connections[0].options.signal?.aborted).toBe(true);
  });

  test("keeps the connection when a consumer remounts during navigation", async () => {
    const { manager, connections, timers } = createHarness();
    const unsubscribe = manager.subscribe(subscriber([]).sub);
    await flush();

    unsubscribe();
    manager.subscribe(subscriber([]).sub);
    await flush();

    expect(timers.every((timer) => timer.cancelled)).toBe(true);
    expect(connections).toHaveLength(1);
    expect(connections[0].options.signal?.aborted).toBe(false);
  });

  test("reconnects with backoff after a drop and resets it once the server confirms the subscription", async () => {
    const { manager, connections, runPendingTimer } = createHarness();
    manager.subscribe(subscriber([]).sub);
    await flush();

    connections.at(-1)!.options.onError?.(new Error("dropped"));
    expect(await runPendingTimer()).toBe(1_000);
    connections.at(-1)!.options.onError?.(new Error("dropped"));
    expect(await runPendingTimer()).toBe(2_000);

    connections.at(-1)!.options.onEvent?.({ type: "CONNECTED", data: {} });
    connections.at(-1)!.options.onError?.(new Error("dropped"));
    expect(await runPendingTimer()).toBe(1_000);
    expect(connections).toHaveLength(4);
  });

  test("keeps backing off when the server accepts the request and closes at once", async () => {
    const { manager, connections, runPendingTimer } = createHarness();
    manager.subscribe(subscriber([]).sub);
    await flush();

    const delays: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      connections.at(-1)!.options.onOpen?.();
      connections.at(-1)!.options.onError?.(new Error("SSE stream closed by server"));
      delays.push(await runPendingTimer());
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  test("does not connect without a session", async () => {
    const { manager, connections, timers } = createHarness(null);
    const { sub, statuses } = subscriber([]);
    manager.subscribe(sub);
    await flush();

    expect(connections).toHaveLength(0);
    expect(timers).toHaveLength(0);
    expect(statuses.at(-1)).toBe(false);
  });

  test("reconnects with the new token when the session changes", async () => {
    const { manager, connections, changeSession } = createHarness("user-a-token");
    const { sub, statuses } = subscriber([]);
    manager.subscribe(sub);
    await flush();
    connections[0].options.onEvent?.({ type: "CONNECTED", data: {} });

    await changeSession("user-b-token");

    expect(connections[0].options.signal?.aborted).toBe(true);
    expect(connections).toHaveLength(2);
    expect(connections[1].options.accessToken).toBe("user-b-token");
    expect(statuses.at(-1)).toBe(false);
  });

  test("closes the stream when the session ends", async () => {
    const { manager, connections, changeSession } = createHarness();
    manager.subscribe(subscriber([]).sub);
    await flush();

    await changeSession(null);

    expect(connections[0].options.signal?.aborted).toBe(true);
    expect(connections).toHaveLength(1);
  });

  test("keeps the connection when the session is unchanged", async () => {
    const { manager, connections, changeSession } = createHarness();
    manager.subscribe(subscriber([]).sub);
    await flush();

    await changeSession("token-1");

    expect(connections).toHaveLength(1);
    expect(connections[0].options.signal?.aborted).toBe(false);
  });

  test("connects once another tab signs in", async () => {
    const { manager, connections, changeSession } = createHarness(null);
    manager.subscribe(subscriber([]).sub);
    await flush();
    expect(connections).toHaveLength(0);

    await changeSession("new-session-token");

    expect(connections).toHaveLength(1);
    expect(connections[0].options.accessToken).toBe("new-session-token");
  });

  test("stops watching the session once the stream closes", async () => {
    const { manager, authListeners, runPendingTimer } = createHarness();
    const unsubscribe = manager.subscribe(subscriber([]).sub);
    await flush();
    expect(authListeners.size).toBe(1);

    unsubscribe();
    await runPendingTimer();

    expect(authListeners.size).toBe(0);
  });
});
