import { describe, it, expect, afterEach } from "bun:test";
import { AngelOneWorker } from "./angelone-ws";
import { bus } from "../infra/bus";
import type { AngelOneSession } from "../data/sources/angelone/client";

const session: AngelOneSession = {
  jwt: "JWT",
  feedToken: "FEED",
  refreshToken: "REFRESH",
  clientCode: "C",
  apiKey: "K",
  obtainedAt: new Date().toISOString(),
};

afterEach(() => bus.off("tick", () => {}));

describe("AngelOneWorker", () => {
  it("emits ticks on bus when a message arrives", async () => {
    const w = new AngelOneWorker({ url: "ws://localhost:1", createSocket: () => makeFakeSocket() });
    w.manageUser("u1", session, ["RELIANCE"]);
    w.start();
    await new Promise((r) => setTimeout(r, 50));
    const received: any[] = [];
    bus.on("tick", (t) => received.push(t));
    // Simulate an incoming message via the fake socket
    const sock = (w as any).sockets.get("u1");
    sock.__push({
      type: "sf",
      data: {
        symbol: "RELIANCE",
        last_traded_price: 100,
        volume_traded_for_the_day: 1,
        exchange_timestamp: new Date().toISOString(),
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].symbol).toBe("RELIANCE");
    await w.stop();
  });
});

function makeFakeSocket() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const sock: any = {
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] ||= []).push(cb);
    },
    send() {},
    close() {
      (listeners["close"] || []).forEach((cb) => cb());
    },
    __push(data: unknown) {
      (listeners["message"] || []).forEach((cb) => cb(Buffer.from(JSON.stringify(data))));
    },
  };
  // expose back to caller
  (sock as any).__mark = true;
  return sock;
}
