import { describe, it, expect } from "bun:test";
import { bus } from "./bus";

describe("bus", () => {
  it("emits and receives a typed tick event", () => {
    const received: unknown[] = [];
    const handler = (t: unknown) => received.push(t);
    bus.on("tick", handler);
    const tick = { exchange: "NSE", symbol: "X", price: 1, volume: 1, ts: new Date().toISOString() };
    bus.emit("tick", tick);
    bus.off("tick", handler);
    expect(received).toHaveLength(1);
  });

  it("off removes the listener", () => {
    let count = 0;
    const handler = () => count++;
    bus.on("tick", handler);
    bus.emit("tick", { exchange: "NSE", symbol: "X", price: 1, volume: 1, ts: new Date().toISOString() });
    bus.off("tick", handler);
    bus.emit("tick", { exchange: "NSE", symbol: "X", price: 1, volume: 1, ts: new Date().toISOString() });
    expect(count).toBe(1);
  });
});
