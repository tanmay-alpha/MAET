import { describe, it, expect, afterEach } from "bun:test";
import { ANGEL_SESSION_TOKEN_CAP, AngelSubscriptionBudget, AngelOneWorker, parseAngelOnePacket } from "./angelone-ws";
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

describe("AngelOneWorker socket lifecycle", () => {
  it("does not send on a socket that is still connecting and subscribes on open", () => {
    const socket = makeWsLikeSocket();
    const w = new AngelOneWorker({ createSocket: () => socket });
    w.manageUser("u1", session, ["2885"]);
    w.start();

    expect(() => w.updateTokens("u1", ["2885", "11536"])).not.toThrow();
    socket.__open();

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]).params.tokenList[0].tokens).toEqual(["2885", "11536"]);
    void w.stop();
  });

  it("ignores the late close of a replaced socket", async () => {
    const sockets = [makeWsLikeSocket(), makeWsLikeSocket()];
    let created = 0;
    const w = new AngelOneWorker({ createSocket: () => sockets[created++] });
    w.start();
    w.manageUser("u1", session, ["2885"]);
    sockets[0].__open();
    // Re-login replaces the socket; ws delivers the old socket's close later.
    w.manageUser("u1", { ...session, jwt: "JWT2" }, ["2885"]);
    sockets[1].__open();
    await sockets[0].__closed;

    w.updateTokens("u1", ["2885", "11536"]);
    expect(sockets[1].sent.map((frame) => JSON.parse(frame).action)).toEqual([1, 1]);
    expect(created).toBe(2);
    await w.stop();
  });

  it("does not treat a packet for a token containing 401 as an auth failure", async () => {
    const socket = makeWsLikeSocket();
    const w = new AngelOneWorker({ createSocket: () => socket });
    const failures: string[] = [];
    const off = bus.on("user:angelone:auth_failed", ({ reason }) => failures.push(reason));
    w.manageUser("u1", session, ["2885"]);
    w.start();
    socket.__open();

    socket.__push(makeQuotePacket("14010"));
    w.updateTokens("u1", ["2885", "11536"]);

    off();
    expect(failures).toEqual([]);
    expect(socket.sent).toHaveLength(2);
    await w.stop();
  });

  it("reports a 401 handshake as an auth failure instead of reconnecting", async () => {
    let created = 0;
    const socket = makeWsLikeSocket();
    const w = new AngelOneWorker({
      createSocket: () => {
        created++;
        return socket;
      },
    });
    const failures: string[] = [];
    const off = bus.on("user:angelone:auth_failed", ({ reason }) => failures.push(reason));
    w.manageUser("u1", session, ["2885"]);
    w.start();

    socket.__error(new Error("Unexpected server response: 401"));
    socket.close();
    await socket.__closed;

    off();
    expect(failures).toEqual(["handshake_unauthorized"]);
    w.updateTokens("u1", ["11536"]);
    expect(created).toBe(1);
    await w.stop();
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
  return sock;
}

function makeQuotePacket(token = "2885"): Buffer {
  const packet = Buffer.alloc(123);
  packet.writeUInt8(2, 0);
  packet.writeUInt8(1, 1);
  packet.write(token, 2, "utf8");
  packet.writeBigUInt64LE(BigInt(Date.now()), 35);
  packet.writeBigInt64LE(130_800n, 43);
  packet.writeBigInt64LE(6_999_059n, 67);
  packet.writeBigInt64LE(129_390n, 115);
  return packet;
}

/** Models `ws`: send() throws unless OPEN, and close is delivered asynchronously. */
function makeWsLikeSocket() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const emit = (event: string, ...args: unknown[]) => (listeners[event] || []).forEach((cb) => cb(...args));
  const closed = Promise.withResolvers<void>();
  let state: "CONNECTING" | "OPEN" | "CLOSED" = "CONNECTING";
  return {
    sent: [] as string[],
    __closed: closed.promise,
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ||= []).push(cb);
    },
    send(data: string) {
      if (state !== "OPEN") throw new Error(`WebSocket is not open: readyState ${state}`);
      this.sent.push(data);
    },
    close() {
      if (state === "CLOSED") return;
      state = "CLOSED";
      queueMicrotask(() => {
        emit("close");
        closed.resolve();
      });
    },
    __open() {
      state = "OPEN";
      emit("open");
    },
    __push(data: Buffer) {
      emit("message", data);
    },
    __error(error: Error) {
      emit("error", error);
    },
  };
}

describe("Angel One session subscription quota", () => {
  const tokenOf = (symbol: string) => `T-${symbol}`;
  const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("keeps the combined set under the 1000-subscription session quota", () => {
    expect(ANGEL_SESSION_TOKEN_CAP).toBeLessThan(1000);
    const budget = new AngelSubscriptionBudget({ warn() {} });
    const tokens = budget.select([many("P", 150), many("A", 600), many("S", 600)], tokenOf);
    expect(tokens).toHaveLength(ANGEL_SESSION_TOKEN_CAP);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("keeps paper interest first, then alerts, then open streams", () => {
    const budget = new AngelSubscriptionBudget({ warn() {} }, 5);
    const tokens = budget.select([["ORD", "POS"], ["ALERT1", "ALERT2"], ["STREAM1", "STREAM2"]], tokenOf);
    expect(tokens).toEqual(["T-ORD", "T-POS", "T-ALERT1", "T-ALERT2", "T-STREAM1"]);
  });

  it("counts a symbol once when several sources want it, and skips symbols without a token", () => {
    const budget = new AngelSubscriptionBudget({ warn() {} }, 3);
    const tokens = budget.select([["A"], ["A", "NOTOKEN", "B"], ["B", "C", "D"]], (s) => (s === "NOTOKEN" ? undefined : tokenOf(s)));
    expect(tokens).toEqual(["T-A", "T-B", "T-C"]);
  });

  it("logs once per change of the dropped set, not on every sync", () => {
    const warnings: unknown[] = [];
    const budget = new AngelSubscriptionBudget({ warn: (fields) => warnings.push(fields) }, 2);
    const groups = [["P"], ["A"], ["S1", "S2"]];
    for (let i = 0; i < 10; i++) budget.select(groups, tokenOf);
    expect(warnings).toHaveLength(1);
    budget.select([["P"], ["A"], ["S1", "S2", "S3"]], tokenOf);
    expect(warnings).toHaveLength(2);
    budget.select([["P"]], tokenOf);
    budget.select([["P"], ["A"], ["S1", "S2", "S3"]], tokenOf);
    expect(warnings).toHaveLength(3);
  });

  it("reports a dropped symbol once even when several sources want it", () => {
    const warnings: Record<string, unknown>[] = [];
    const budget = new AngelSubscriptionBudget({ warn: (fields) => warnings.push(fields) }, 1);
    budget.select([["P"], ["X"], ["X"]], tokenOf);
    expect(warnings[0]?.dropped).toBe(1);
  });
});
