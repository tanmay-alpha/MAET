/**
 * One Redis subscriber connection per process, fanned out in memory to every
 * open GET /api/paper/stream response. A connection per stream does not scale
 * (each SSE client would hold its own Redis connection, SEC-4), and opening one
 * per request put a full connection handshake inside SUBSCRIBE's timeout.
 */
import { paperUserChannel } from "@shared/domain/paper-trading/stream-events";
import type Redis from "ioredis";
import { getRedis } from "../../data/redis/client";

export interface PaperStreamSubscriberConnection {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
}

export type PaperStreamListener = (message: string) => void;

export class PaperStreamUnavailableError extends Error {
  override name = "PaperStreamUnavailableError";
}

/** SUBSCRIBE may have to wait for the subscriber's first connection (TCP, TLS, AUTH, ready check). */
export const PAPER_STREAM_SUBSCRIBE_TIMEOUT_MS = 5_000;

export interface PaperStreamHubOptions {
  /** Opens the shared subscriber connection; called once, on first use. */
  createSubscriber: () => PaperStreamSubscriberConnection;
  /** Resolves when a pending SUBSCRIBE should be given up on. */
  subscribeDeadline?: () => Promise<void>;
}

function timerDeadline(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, PAPER_STREAM_SUBSCRIBE_TIMEOUT_MS).unref?.();
  return promise;
}

export class PaperStreamHub {
  private connection: PaperStreamSubscriberConnection | undefined;
  private readonly listeners = new Map<string, Set<PaperStreamListener>>();
  /** SUBSCRIBE in flight or done per channel; rejected subscriptions are removed. */
  private readonly subscriptions = new Map<string, Promise<unknown>>();

  constructor(private readonly options: PaperStreamHubOptions) {}

  private subscriber(): PaperStreamSubscriberConnection {
    if (!this.connection) {
      this.connection = this.options.createSubscriber();
      this.connection.on("message", (channel, message) => {
        for (const listener of this.listeners.get(channel) ?? []) listener(message);
      });
    }
    return this.connection;
  }

  /**
   * Delivers the user's notifications to `listener` until the returned release
   * function is called. Rejects with PaperStreamUnavailableError when Redis
   * cannot confirm the subscription in time.
   */
  async subscribe(userId: string, listener: PaperStreamListener): Promise<() => void> {
    const channel = paperUserChannel(userId);
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
    }
    channelListeners.add(listener);
    const release = () => this.release(channel, listener);

    let subscription = this.subscriptions.get(channel);
    if (!subscription) {
      subscription = Promise.resolve().then(() => this.subscriber().subscribe(channel));
      this.subscriptions.set(channel, subscription);
      subscription.catch(() => {
        if (this.subscriptions.get(channel) === subscription) this.subscriptions.delete(channel);
      });
    }

    const deadline = (this.options.subscribeDeadline ?? timerDeadline)().then(() => "timeout" as const);
    let outcome: "subscribed" | "timeout";
    try {
      outcome = await Promise.race([subscription.then(() => "subscribed" as const), deadline]);
    } catch (error) {
      release();
      throw new PaperStreamUnavailableError(`paper stream subscribe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (outcome === "timeout") {
      release();
      throw new PaperStreamUnavailableError("paper stream subscribe timed out");
    }
    return release;
  }

  private release(channel: string, listener: PaperStreamListener): void {
    const channelListeners = this.listeners.get(channel);
    if (!channelListeners?.delete(listener) || channelListeners.size > 0) return;
    this.listeners.delete(channel);
    const subscription = this.subscriptions.get(channel);
    this.subscriptions.delete(channel);
    // Unsubscribe once a SUBSCRIBE that is still in flight has landed.
    subscription
      ?.then(() => {
        if (!this.listeners.has(channel)) return this.connection?.unsubscribe(channel);
      })
      .catch(() => {});
  }

  /** Number of channels with at least one open stream. */
  channelCount(): number {
    return this.listeners.size;
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.listeners.clear();
    this.subscriptions.clear();
    await connection?.quit().catch(() => {});
  }
}

/**
 * The shared client fails fast (no offline queue, 1s command timeout). The
 * subscriber instead queues SUBSCRIBE until its own socket (TCP, TLS, AUTH,
 * ready check) is up, and the hub's deadline, not a per-command timeout,
 * bounds the wait. ioredis re-subscribes its channels after a reconnect.
 */
export function createPaperStreamSubscriber(shared: Redis): Redis {
  const subscriber = shared.duplicate({ enableOfflineQueue: true, commandTimeout: undefined });
  // Connection errors surface through the shared client's state logging; an
  // ioredis instance without an error listener would report them as unhandled.
  subscriber.on("error", () => {});
  return subscriber;
}

export const paperStreamHub = new PaperStreamHub({
  createSubscriber: () => createPaperStreamSubscriber(getRedis()),
});
