import type { QueryClient } from "@tanstack/react-query";
import { PAPER_STREAM_CONNECTED_EVENT, isPaperOutboxEventType } from "@shared/domain/paper-trading/stream-events";
import { getCurrentAccessToken, watchStoredSession } from "./auth-token";
import { connectPaperTradingStream, type ConnectPaperTradingStreamOptions } from "./paper-sse-client";
import { reconnectDelayMs, scheduleTimeout, type ScheduleFn } from "./reconnect-backoff";

export interface PaperStreamSubscriber {
  queryClient: Pick<QueryClient, "invalidateQueries">;
  onStatusChange: (connected: boolean) => void;
}

export interface PaperStreamDeps {
  getToken: () => Promise<string | null>;
  /** Subscribes to session changes (sign-in, sign-out, refresh, in this tab or another); returns the unsubscribe function. */
  watchAuth: (onChange: () => void) => () => void;
  connect: (options: ConnectPaperTradingStreamOptions) => Promise<void>;
  schedule: ScheduleFn;
  random: () => number;
}

// Route changes unmount one page's consumers before the next page mounts its own;
// keep the stream open briefly so navigation doesn't tear it down and reopen it.
const IDLE_CLOSE_DELAY_MS = 1_000;

/**
 * One authenticated paper-trading SSE connection shared by every usePaperAccount()
 * consumer. Ref-counted: opens on the first subscriber, closes shortly after the last
 * one leaves, reconnects with capped exponential backoff after drops, and reopens with
 * the new credentials when the session changes (sign-in, sign-out, user switch).
 */
export class PaperStreamManager {
  private static instance: PaperStreamManager | null = null;
  private subscribers = new Set<PaperStreamSubscriber>();
  private controller: AbortController | null = null;
  private cancelRetry: (() => void) | null = null;
  private cancelIdleClose: (() => void) | null = null;
  private failures = 0;
  private connected = false;
  // Token the current (or last attempted) connection authenticated with.
  private token: string | null = null;
  private stopWatchingAuth: (() => void) | null = null;

  constructor(private readonly deps: PaperStreamDeps) {}

  static getInstance(): PaperStreamManager {
    PaperStreamManager.instance ??= new PaperStreamManager({
      getToken: getCurrentAccessToken,
      watchAuth: watchStoredSession,
      connect: connectPaperTradingStream,
      schedule: scheduleTimeout,
      random: Math.random,
    });
    return PaperStreamManager.instance;
  }

  subscribe(subscriber: PaperStreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber.onStatusChange(this.connected);
    this.cancelIdleClose?.();
    this.cancelIdleClose = null;
    this.stopWatchingAuth ??= this.deps.watchAuth(() => void this.onSessionChanged());
    if (!this.controller && !this.cancelRetry) void this.open();

    return () => {
      if (!this.subscribers.delete(subscriber) || this.subscribers.size > 0) return;
      this.cancelIdleClose = this.deps.schedule(() => {
        this.cancelIdleClose = null;
        this.close();
      }, IDLE_CLOSE_DELAY_MS);
    };
  }

  private async open() {
    this.cancelRetry = null;
    const controller = new AbortController();
    this.controller = controller;

    const token = await this.deps.getToken();
    if (controller.signal.aborted) return;
    this.token = token;
    if (!token) {
      // Signed out: consumers fall back to polling until a session appears.
      this.controller = null;
      this.setConnected(false);
      return;
    }

    await this.deps.connect({
      accessToken: token,
      signal: controller.signal,
      // Reset the backoff only once the server confirms the subscription: a proxy or
      // crashing handler can answer 200 and close at once, which must still back off.
      onEvent: (event) => {
        if (controller.signal.aborted) return;
        if (event.type === PAPER_STREAM_CONNECTED_EVENT) {
          this.failures = 0;
          this.setConnected(true);
          // Every outbox event is a committed change to the account's state.
        } else if (isPaperOutboxEventType(event.type)) this.invalidateState();
      },
      onError: () => {
        if (controller.signal.aborted) return;
        this.controller = null;
        this.setConnected(false);
        if (this.subscribers.size === 0) return;
        this.cancelRetry = this.deps.schedule(() => void this.open(), reconnectDelayMs(this.failures++, this.deps.random));
      },
    });
  }

  // The open stream is bound to the identity it authenticated with; when another tab
  // signs in, signs out or replaces the token, reconnect with the current credentials.
  private async onSessionChanged() {
    if (this.subscribers.size === 0) return;
    const token = await this.deps.getToken();
    if (token === this.token || this.subscribers.size === 0) return;
    this.disconnect();
    void this.open();
  }

  private disconnect() {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.controller?.abort();
    this.controller = null;
    this.failures = 0;
    this.setConnected(false);
  }

  private close() {
    this.disconnect();
    this.stopWatchingAuth?.();
    this.stopWatchingAuth = null;
    this.token = null;
  }

  private invalidateState() {
    const clients = new Set([...this.subscribers].map((subscriber) => subscriber.queryClient));
    clients.forEach((client) => void client.invalidateQueries({ queryKey: ["paperTrading"] }));
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.subscribers.forEach((subscriber) => subscriber.onStatusChange(connected));
  }
}
