import { bus } from "../../infra/bus";
import { getRedis } from "../../data/redis/client";
import { RedisKeys } from "../../data/redis/keys";
import type { Tick } from "@shared/types";

type SendFn = (event: string, data: unknown) => void;
type CloseFn = () => void;

type Connection = {
  connId: string;
  userId: string;
  symbols: string[];
  send: SendFn;
  close: CloseFn;
  pending: number;
  lastWrite: number;
};

const HEARTBEAT_MS = 30_000;
const SLOW_TIMEOUT_MS = 1_000;

export class SseHub {
  private conns = new Map<string, Connection>();
  private writeQueueTimeoutMs: number;
  private pendingTicks = new Map<string, Tick>();
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: { writeQueueTimeoutMs?: number } = {}) {
    this.writeQueueTimeoutMs = opts.writeQueueTimeoutMs ?? SLOW_TIMEOUT_MS;
    bus.on("tick", (t) => this.queueTick(t));
    this.startFlushInterval();
  }

  private queueTick(tick: Tick): void {
    this.pendingTicks.set(tick.symbol, tick);
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      if (this.pendingTicks.size === 0) return;
      const ticks = Array.from(this.pendingTicks.values());
      this.pendingTicks.clear();
      for (const t of ticks) {
        this.broadcastTick(t);
      }
    }, 200);
  }

  register(connId: string, userId: string, symbols: string[], send: SendFn, close: CloseFn): void {
    this.conns.set(connId, { connId, userId, symbols, send, close, pending: 0, lastWrite: Date.now() });
    const r = getRedis();
    const tx = r.multi();
    for (const s of symbols) tx.sadd(RedisKeys.sseSubsKey(s), connId);
    tx.hset(RedisKeys.sseConnKey(connId), { userId, symbols: symbols.join(","), lastWrite: String(Date.now()) });
    tx.expire(RedisKeys.sseConnKey(connId), 60);
    tx.exec();
  }

  unregister(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    const r = getRedis();
    const tx = r.multi();
    for (const s of c.symbols) tx.srem(RedisKeys.sseSubsKey(s), connId);
    tx.del(RedisKeys.sseConnKey(connId));
    tx.exec();
    this.conns.delete(connId);
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  broadcastTick(tick: Tick): void {
    for (const c of this.conns.values()) {
      if (!c.symbols.includes(tick.symbol)) continue;
      c.pending++;
      try {
        c.send("tick", tick);
        c.lastWrite = Date.now();
      } catch {
        try { c.send("dropped", { reason: "send_failed" }); } catch {}
        this.unregister(c.connId);
        c.close();
      } finally {
        c.pending--;
      }
    }
  }

  dropStaleConnections(): void {
    const now = Date.now();
    for (const c of this.conns.values()) {
      if (now - c.lastWrite > HEARTBEAT_MS) {
        try { c.send("dropped", { reason: "heartbeat_timeout" }); } catch {}
        this.unregister(c.connId);
        c.close();
      }
    }
  }
}

export const sseHub = new SseHub();
