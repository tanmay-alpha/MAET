import { bus } from "../infra/bus";
import { getLogger as getInfraLogger } from "../infra/logger";
import { defaultWsFactory, type WsFactory, type WsLike } from "../data/sources/angelone/ws";
import type { AngelOneSession } from "../data/sources/angelone/client";
import { lookupSymbolByToken } from "../domain/market/symbol";
import { currentMarketPhase, sessionQuality } from "../domain/market/quote-quality";
import type { Tick } from "@shared/types";

const WS_URL = "wss://smartapisocket.angelone.in/smart-stream";
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_MS = 30_000;

type UserState = {
  session: AngelOneSession;
  tokens: string[];
  reconnectAttempts: number;
};

/** One socket per user. `open` gates sends: `ws` throws on send while CONNECTING. */
type Connection = {
  socket: WsLike;
  open: boolean;
  heartbeat?: ReturnType<typeof setInterval>;
};

export type WorkerOptions = {
  url?: string;
  createSocket?: WsFactory;
};

// `getLogger()` calls `getConfig()` which requires env vars. Resolve lazily
// so env-less test runs do not crash at module load.
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
  return getInfraLogger();
}

/** Stream-level rejection message from SmartAPI (JSON text frame). */
class AngelOneStreamRejection extends Error {}

/** `ws` reports a rejected upgrade as "Unexpected server response: <status>". */
function isHandshakeAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected server response: 401\b/.test(message);
}

function isAuthRejection(message: string): boolean {
  return /invalid[\s_-]*(jwt|feed[\s_-]*)?token|token[\s_-]*expired|unauthori[sz]ed/i.test(message);
}

export class AngelOneWorker {
  private url: string;
  private factory: WsFactory;
  private users = new Map<string, UserState>();
  private connections = new Map<string, Connection>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
    for (const uid of [...this.users.keys(), ...this.connections.keys()]) this.dropUser(uid);
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
    // A socket that is still connecting subscribes to `state.tokens` on open.
    const connection = this.connections.get(userId);
    if (!connection?.open) return;

    this.sendSubscription(connection.socket, 0, [...previous].filter((token) => !next.has(token)));
    this.sendSubscription(connection.socket, 1, [...next].filter((token) => !previous.has(token)));
  }

  dropUser(userId: string): void {
    this.users.delete(userId);
    clearTimeout(this.reconnectTimers.get(userId));
    this.reconnectTimers.delete(userId);
    const connection = this.connections.get(userId);
    if (connection) {
      // Remove before close(): the socket's own close event is then stale.
      this.connections.delete(userId);
      clearInterval(connection.heartbeat);
      try { connection.socket.close(); } catch {}
    }
  }

  private isCurrent(userId: string, socket: WsLike): boolean {
    return this.connections.get(userId)?.socket === socket;
  }

  private authFailed(userId: string, reason: string): void {
    bus.emit("user:angelone:auth_failed", { userId, reason });
    this.dropUser(userId);
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
    const connection: Connection = { socket: sock, open: false };
    this.connections.set(userId, connection);

    sock.on("open", () => {
      if (!this.isCurrent(userId, sock)) return;
      const state = this.users.get(userId);
      if (!state) return;
      connection.open = true;
      state.reconnectAttempts = 0;
      this.sendSubscription(sock, 1, state.tokens);
      connection.heartbeat = setInterval(() => {
        try { sock.send("ping"); } catch {}
      }, HEARTBEAT_MS);
      bus.emit("user:angelone:ready", { userId });
    });
    sock.on("message", (raw) => {
      if (!this.isCurrent(userId, sock)) return;
      try {
        const buffer = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw as ArrayBuffer);
        const text = buffer.toString("utf8");
        if (text === "pong" || text === "ping") return;
        if (text.trimStart().startsWith("{")) {
          const msg = JSON.parse(text);
          if (msg.status === false || msg.errorCode) {
            throw new AngelOneStreamRejection(msg.errorMessage ?? msg.message ?? "Angel One stream rejected request");
          }
          return;
        }

        const tick = parseAngelOnePacket(buffer);
        const now = new Date();
        bus.emit("tick", { ...tick, quality: sessionQuality(tick, now, currentMarketPhase(now)) });
      } catch (e) {
        const message = (e as Error).message;
        // Only provider rejections can mean auth failure; packet parse errors
        // (e.g. "Unknown Angel One token: 14010") never do.
        if (e instanceof AngelOneStreamRejection && isAuthRejection(message)) {
          this.authFailed(userId, "invalid_token");
          return;
        }
        getLog().warn({ err: message }, "ws message parse failed");
      }
    });
    sock.on("close", () => {
      // A replaced or dropped socket closes asynchronously; it must not touch
      // the user's current connection or schedule a reconnect.
      if (!this.isCurrent(userId, sock)) return;
      this.connections.delete(userId);
      clearInterval(connection.heartbeat);
      const state = this.users.get(userId);
      if (this.stopped || !state) return;
      if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.authFailed(userId, "reconnect_exhausted");
        return;
      }
      const wait = Math.min(30_000, 500 * Math.pow(2, state.reconnectAttempts));
      state.reconnectAttempts++;
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(userId);
        this.connect(userId);
      }, wait);
      this.reconnectTimers.set(userId, timer);
    });
    sock.on("error", (e) => {
      if (!this.isCurrent(userId, sock)) return;
      if (isHandshakeAuthFailure(e)) {
        // Reconnecting with the same JWT would fail identically; ask for a re-login.
        this.authFailed(userId, "handshake_unauthorized");
        return;
      }
      getLog().warn({ err: (e as Error)?.message }, "ws error");
    });
  }

  private sendSubscription(socket: WsLike, action: 0 | 1, tokens: string[]): void {
    if (tokens.length === 0) return;
    try {
      socket.send(JSON.stringify({
        correlationID: `maet-${Date.now()}`,
        action,
        params: {
          mode: 2,
          tokenList: [{ exchangeType: 1, tokens }],
        },
      }));
    } catch (e) {
      // Socket closed between the open check and send; the close handler reconnects
      // and the next open re-subscribes from the user's token list.
      getLog().warn({ err: (e as Error).message, action }, "ws subscription send failed");
    }
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
  const catalog = lookupSymbolByToken(token);
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
    quality: "live",
    previousClose: previousClose && previousClose > 0 ? previousClose : undefined,
    change,
    changePct: change !== undefined && previousClose ? (change / previousClose) * 100 : undefined,
    currency: "INR",
  };
}
