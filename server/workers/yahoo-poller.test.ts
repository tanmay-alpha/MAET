import { describe, it, expect, afterEach } from "bun:test";
import { YahooPoller } from "./yahoo-poller";
import { bus } from "../infra/bus";
import type { Tick } from "@shared/types";

describe("YahooPoller", () => {
  afterEach(() => {
    bus.off("tick", () => {});
  });

  it("polls subscribed symbols on interval and emits ticks on the bus", async () => {
    let calls = 0;
    const symbols = ["RELIANCE", "TCS"];
    const tick: Tick = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500.5,
      volume: 100,
      ts: new Date().toISOString(),
      source: "yahoo",
    };

    const p = new YahooPoller({
      intervalMs: 50,
      batchFetch: async (syms: string[]) => {
        calls++;
        return syms.map(() => tick);
      },
    });

    const received: Tick[] = [];
    bus.on("tick", (t) => received.push(t));

    p.subscribe(symbols);
    p.start();

    await new Promise<void>((res) => setTimeout(res, 175));
    p.stop();

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(received.length).toBeGreaterThanOrEqual(2);
    for (const t of received) {
      expect(t.symbol).toBe("RELIANCE");
      expect(t.source).toBe("yahoo");
    }
  });

  it("stops polling after stop()", async () => {
    let calls = 0;
    const p = new YahooPoller({
      intervalMs: 30,
      batchFetch: async (syms: string[]) => {
        calls++;
        return syms.map((s) => ({
          exchange: "NSE" as const,
          symbol: s,
          price: 1,
          volume: 0,
          ts: new Date().toISOString(),
          source: "yahoo" as const,
        }));
      },
    });

    p.subscribe(["INFY"]);
    p.start();
    await new Promise<void>((res) => setTimeout(res, 100));
    p.stop();
    const callsAtStop = calls;
    await new Promise<void>((res) => setTimeout(res, 100));
    expect(calls).toBe(callsAtStop);
  });

  it("unsubscribe removes symbols from polling", async () => {
    const seen: string[][] = [];
    const p = new YahooPoller({
      intervalMs: 30,
      batchFetch: async (syms: string[]) => {
        seen.push([...syms]);
        return syms.map((s) => ({
          exchange: "NSE" as const,
          symbol: s,
          price: 1,
          volume: 0,
          ts: new Date().toISOString(),
          source: "yahoo" as const,
        }));
      },
    });

    p.subscribe(["RELIANCE", "TCS"]);
    p.start();
    await new Promise<void>((res) => setTimeout(res, 80));
    p.unsubscribe(["RELIANCE"]);
    const beforeUnsub = seen.length;
    await new Promise<void>((res) => setTimeout(res, 80));
    p.stop();

    expect(beforeUnsub).toBeGreaterThanOrEqual(1);
    for (let i = beforeUnsub; i < seen.length; i++) {
      expect(seen[i]).not.toContain("RELIANCE");
      expect(seen[i]).toContain("TCS");
    }
  });

  it("continues polling after a batch-level failure", async () => {
    let calls = 0;
    let shouldFail = true;
    const p = new YahooPoller({
      intervalMs: 30,
      batchFetch: async (syms: string[]) => {
        calls++;
        if (shouldFail) throw new Error("transient upstream error");
        return syms.map((s) => ({
          exchange: "NSE" as const,
          symbol: s,
          price: 1,
          volume: 0,
          ts: new Date().toISOString(),
          source: "yahoo" as const,
        }));
      },
    });

    p.subscribe(["RELIANCE"]);
    p.start();
    await new Promise<void>((res) => setTimeout(res, 80));
    shouldFail = false;
    await new Promise<void>((res) => setTimeout(res, 80));
    p.stop();

    expect(calls).toBeGreaterThanOrEqual(3);
  });
});