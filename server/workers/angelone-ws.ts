import { bus } from "../infra/bus";
import { defaultWsFactory, type WsFactory, type WsLike } from "../data/sources/angelone/ws";
import type { AngelOneSession } from "../data/sources/angelone/client";
import { SYMBOLS } from "../domain/market/symbol";
import type { Tick } from "@shared/types";

const WS_URL = "wss://smartapisocket.angelone.in/smart-stream";
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_MS = 30_000;
const symbolByToken = new Map(SYMBOLS.map((symbol) => [symbol.token, symbol]));

type UserState = {
  session: AngelOneSession;
  tokens: string[];
  socket?: WsLike;
  reconnectAttempts: number;
};

export type WorkerOptions = {
  url?: string;
  createSocket?: WsFactory;
};

// Lazy logger init — same env-caveat pattern as yahoo-poller (Task 18).
// `getLogger()` calls `getConfig()` which requires env vars. We defer
// resolution to first use so env-less test runs do not crash at module load.
let cachedLog: ReturnType<ReturnType<typeof getLogger>["child"]> | undefined;
function getLog() {
  if (cachedLog) return cachedLog;
  try {
    cachedLog = getLogger().child({ worker: "angelone-ws" });
  } catch {
    const noop = {
      warn: (..._args: unknown[]) => {},
      info: (..._args: unknown[]) => {},
      error: (..._args: unknown[]) => {},
      debug: (..._args: unknown[]) => {},
    };
    cachedLog = noop as unknown as ReturnType<ReturnType<typeof getLogger>["child"]>;
  }
  return cachedLog;
}

function getLogger() {
  // Lazy import: avoids loading logger.ts (and transitively config.ts +
  // env-var schema) at module load time, keeping env-less tests green.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../infra/logger").getLogger() as ReturnType<typeof import("../infra/logger").getLogger>;
}

export class AngelOneWorker {
  private url: string;
  private factory: WsFactory;
  private users = new Map<string, UserState>();
  private sockets = new Map<string, WsLike>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private stopped = true;

  constructor(opts: WorkerOptions = {}) {
    this.url = opts.url ?? WS_URL;
    this.factory = opts.createSocket ?? defaultWsFactory;
  }

  start(): void {
    this.stopped = false;
    // Connect any users that were managed before start() was called.
    for (const uid of this.users.keys()) {
      this.connect(uid);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const timer of this.heartbeatTimers.values()) clearInterval(timer);
    this.heartbeatTimers.clear();
    for (const [uid, s] of this.sockets) {
      try { s.close(); } catch {}
      this.sockets.delete(uid);
    }
    this.users.clear();
  }

  manageUser(userId: string, session: AngelOneSession, tokens: string[]): void {
    this.dropUser(userId);
    this.users.set(userId, { session, tokens, reconnectAttempts: 0 });
    if (!this.stopped) this.connect(userId);
  }

  updateTokens(userId: string, tokens: string[]): void {
    const state = this.users.get(userId);
    if (!state) return;
    const previous = new Set(state.tokens);
    const next = new Set(tokens);
    state.tokens = [...next];
    const socket = this.sockets.get(userId);
    if (!socket) return;

    this.sendSubscription(socket, 0, [...previous].filter((token) => !next.has(token)));
    this.sendSubscription(socket, 1, [...next].filter((token) => !previous.has(token)));
  }

  dropUser(userId: string): void {
    this.users.delete(userId);
    const s = this.sockets.get(userId);
    const timer = this.reconnectTimers.get(userId);
    const heartbeat = this.heartbeatTimers.get(userId);
    if (timer) clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    this.reconnectTimers.delete(userId);
    this.heartbeatTimers.delete(userId);
    if (s) {
      try { s.close(); } catch {}
      this.sockets.delete(userId);
    }
  }

  private connect(userId: string): void {
    const u = this.users.get(userId);
    if (!u) return;
    const sock = this.factory(this.url, {
      Authorization: `Bearer ${u.session.jwt.replace(/^Bearer\s+/i, "")}`,
      "x-api-key": u.session.apiKey,
      "x-client-code": u.session.clientCode,
      "x-feed-token": u.session.feedToken,
    });
    this.sockets.set(userId, sock);
    sock.on("open", () => {
      u.reconnectAttempts = 0;
      this.sendSubscription(sock, 1, u.tokens);
      const heartbeat = setInterval(() => {
        try { sock.send("ping"); } catch {}
      }, HEARTBEAT_MS);
      this.heartbeatTimers.set(userId, heartbeat);
      bus.emit("user:angelone:ready", { userId });
    });
    sock.on("message", (raw) => {
      try {
        const buffer = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw as ArrayBuffer);
        const text = buffer.toString("utf8");
        if (text === "pong" || text === "ping") return;
        if (text.trimStart().startsWith("{")) {
          const msg = JSON.parse(text);
          if (msg.status === false || msg.errorCode) {
            throw new Error(msg.errorMessage ?? msg.message ?? "Angel One stream rejected request");
          }
          return;
        }

        bus.emit("tick", parseAngelOnePacket(buffer));
      } catch (e) {
        const message = (e as Error).message;
        if (/invalid.*token|401/i.test(message)) {
          bus.emit("user:angelone:auth_failed", { userId, reason: "invalid_token" });
          this.dropUser(userId);
          return;
        }
        getLog().warn({ err: message }, "ws message parse failed");
      }
    });
    sock.on("close", () => {
      this.sockets.delete(userId);
      const heartbeat = this.heartbeatTimers.get(userId);
      if (heartbeat) clearInterval(heartbeat);
      this.heartbeatTimers.delete(userId);
      if (this.stopped || !this.users.has(userId)) return;
      if (u.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        bus.emit("user:angelone:auth_failed", { userId, reason: "reconnect_exhausted" });
        this.users.delete(userId);
        return;
      }
      const wait = Math.min(30_000, 500 * Math.pow(2, u.reconnectAttempts));
      u.reconnectAttempts++;
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(userId);
        this.connect(userId);
      }, wait);
      this.reconnectTimers.set(userId, timer);
    });
    sock.on("error", (e) => getLog().warn({ err: (e as Error)?.message }, "ws error"));
  }

  private sendSubscription(socket: WsLike, action: 0 | 1, tokens: string[]): void {
    if (tokens.length === 0) return;
    socket.send(JSON.stringify({
      correlationID: `maet-${Date.now()}`,
      action,
      params: {
        mode: 2,
        tokenList: [{ exchangeType: 1, tokens }],
      },
    }));
  }
}

function readToken(buffer: Buffer): string {
  return buffer.subarray(2, 27).toString("utf8").replace(/\0/g, "").trim();
}

function readInt64(buffer: Buffer, offset: number): number {
  return Number(buffer.readBigInt64LE(offset));
}

function timestampIso(value: number): string {
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString();
}

export function parseAngelOnePacket(buffer: Buffer): Tick {
  if (buffer.length < 47) throw new Error("Angel One packet is too short");
  const mode = buffer.readUInt8(0);
  const exchangeType = buffer.readUInt8(1);
  const token = readToken(buffer);
  const catalog = symbolByToken.get(token);
  if (!catalog) throw new Error(`Unknown Angel One token: ${token}`);
  if (exchangeType !== 1) throw new Error(`Unsupported Angel One exchange: ${exchangeType}`);

  const exchangeTimestamp = Number(buffer.readBigUInt64LE(35));
  const lastTradedPrice = mode === 1
    ? buffer.readInt32LE(43)
    : readInt64(buffer, 43);
  const price = lastTradedPrice / 100;
  if (!Number.isFinite(price) || price <= 0) throw new Error("Angel One packet has invalid price");

  const volume = mode >= 2 && buffer.length >= 75 ? Math.max(0, readInt64(buffer, 67)) : 0;
  const previousClose = mode >= 2 && buffer.length >= 123 ? readInt64(buffer, 115) / 100 : undefined;
  const change = previousClose && previousClose > 0 ? price - previousClose : undefined;

  return {
    exchange: catalog.exchange,
    symbol: catalog.symbol,
    price,
    volume,
    ts: timestampIso(exchangeTimestamp),
    source: "angelone",
    previousClose: previousClose && previousClose > 0 ? previousClose : undefined,
    change,
    changePct: change !== undefined && previousClose ? (change / previousClose) * 100 : undefined,
    currency: "INR",
  };
}
