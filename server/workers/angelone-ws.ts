import { bus } from "../infra/bus";
import { normalize } from "../domain/market/tick";
import { defaultWsFactory, type WsFactory, type WsLike } from "../data/sources/angelone/ws";
import type { AngelOneSession } from "../data/sources/angelone/client";

const WS_URL = "wss://smartapis.angelone.in/websocket";
const MAX_RECONNECT_ATTEMPTS = 10;

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
    for (const [uid, s] of this.sockets) {
      try { s.close(); } catch {}
      this.sockets.delete(uid);
    }
    this.users.clear();
  }

  manageUser(userId: string, session: AngelOneSession, tokens: string[]): void {
    this.users.set(userId, { session, tokens, reconnectAttempts: 0 });
    if (!this.stopped) this.connect(userId);
  }

  dropUser(userId: string): void {
    this.users.delete(userId);
    const s = this.sockets.get(userId);
    const timer = this.reconnectTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(userId);
    if (s) {
      try { s.close(); } catch {}
      this.sockets.delete(userId);
    }
  }

  private connect(userId: string): void {
    const u = this.users.get(userId);
    if (!u) return;
    const sock = this.factory(this.url);
    this.sockets.set(userId, sock);
    sock.on("open", () => {
      u.reconnectAttempts = 0;
      // auth handshake
      sock.send(
        JSON.stringify({
          action: 1,
          params: { apiKey: u.session.apiKey, clientCode: u.session.clientCode, feedToken: u.session.feedToken },
        })
      );
      // subscribe
      sock.send(
        JSON.stringify({
          action: 15,
          params: { mode: 1, tokenList: u.tokens.map((t) => ({ exchangeType: 1, tokens: [t] })) },
        })
      );
    });
    sock.on("message", (raw) => {
      try {
        const text = typeof raw === "string" ? raw : Buffer.from(raw as ArrayBuffer).toString();
        const msg = JSON.parse(text);
        // Standard Angel One feed envelope ("sf" with .data payload).
        if (msg.type === "sf" && msg.data) {
          const tick = normalize(msg.data, "NSE", msg.data.symbol ?? "");
          bus.emit("tick", tick);
        }
        if (msg.type === "error" && msg.code === "invalid_token") {
          bus.emit("user:angelone:auth_failed", { userId, reason: "invalid_token" });
          this.dropUser(userId);
        }
      } catch (e) {
        getLog().warn({ err: (e as Error).message }, "ws message parse failed");
      }
    });
    sock.on("close", () => {
      this.sockets.delete(userId);
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
}
