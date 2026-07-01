import { describe, it, expect, afterEach } from "bun:test";
import { AngelOneWorker, parseAngelOnePacket } from "./angelone-ws";
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
    let headers: Record<string, string> | undefined;
    const socket = makeFakeSocket();
    const w = new AngelOneWorker({
      url: "ws://localhost:1",
      createSocket: (_url, passedHeaders) => {
        headers = passedHeaders;
        return socket;
      },
    });
    w.manageUser("u1", session, ["2885"]);
    w.start();
    const received: any[] = [];
    const off = bus.on("tick", (t) => received.push(t));
    socket.__open();
    socket.__push(makeQuotePacket());
    await new Promise((r) => setTimeout(r, 20));
    expect(headers?.["x-feed-token"]).toBe("FEED");
    expect(JSON.parse(socket.sent[0])).toMatchObject({ action: 1, params: { mode: 2 } });
    expect(received).toHaveLength(1);
    expect(received[0].symbol).toBe("RELIANCE");
    expect(received[0].price).toBe(1308);
    expect(received[0].volume).toBe(6_999_059);
    off();
    await w.stop();
  });

  it("decodes SmartAPI quote packets", () => {
    expect(parseAngelOnePacket(makeQuotePacket())).toMatchObject({
      symbol: "RELIANCE",
      source: "angelone",
      price: 1308,
      previousClose: 1293.9,
    });
  });
});

function makeFakeSocket() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const sock: any = {
    sent: [] as string[],
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] ||= []).push(cb);
    },
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      (listeners["close"] || []).forEach((cb) => cb());
    },
    __open() {
      (listeners["open"] || []).forEach((cb) => cb());
    },
    __push(data: Buffer) {
      (listeners["message"] || []).forEach((cb) => cb(data));
    },
  };
  // expose back to caller
  (sock as any).__mark = true;
  return sock;
}

function makeQuotePacket(): Buffer {
  const packet = Buffer.alloc(123);
  packet.writeUInt8(2, 0);
  packet.writeUInt8(1, 1);
  packet.write("2885", 2, "utf8");
  packet.writeBigUInt64LE(BigInt(Date.now()), 35);
  packet.writeBigInt64LE(130_800n, 43);
  packet.writeBigInt64LE(6_999_059n, 67);
  packet.writeBigInt64LE(129_390n, 115);
  return packet;
}
