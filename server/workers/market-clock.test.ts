import { describe, it, expect, afterEach } from "bun:test";
import { MarketClockWorker } from "./market-clock";
import { bus } from "../infra/bus";

afterEach(() => bus.off("market:phase", () => {}));

describe("MarketClockWorker", () => {
  it("emits market:phase when the phase changes", () => {
    const received: any[] = [];
    const off = bus.on("market:phase", (e) => received.push(e));
    let now = new Date("2026-06-19T03:44:00.000Z");
    const w = new MarketClockWorker({ tickMs: 10, getNow: () => now });
    w.start();
    // PRE_OPEN
    now = new Date("2026-06-19T03:45:00.000Z"); // OPEN
    return new Promise<void>((res) => setTimeout(() => {
      w.stop();
      off();
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received.some((e) => e.phase === "OPEN")).toBe(true);
      res();
    }, 100));
  });
});
