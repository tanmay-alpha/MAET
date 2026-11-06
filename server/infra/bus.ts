import { EventEmitter } from "node:events";
import type { Tick } from "@shared/types";

export type ScreenerMatch = {
  userId: string;
  screenerId: string;
  symbol: string;
  tick: Tick;
};

export type OrderFill = {
  userId: string;
  orderId: string;
  fill: { qty: number; price: number; ts: string };
};

export type UserAngelOneReady = { userId: string };
export type UserAngelOneAuthFailed = { userId: string; reason: string };

export type MarketPhaseEvent = {
  phase: "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "AFTER_HOURS";
  ts: string;
};

/**
 * The set of symbols with working paper orders or open positions may have
 * changed; the live feed's paper-interest subscriptions re-read it.
 */
export type PaperInterestChanged = {
  reason: "order_placed" | "order_cancelled" | "order_filled" | "account_reset";
};

export type BusEvents = {
  tick: Tick;
  "screener:match": ScreenerMatch;
  "order:fill": OrderFill;
  "user:angelone:ready": UserAngelOneReady;
  "user:angelone:auth_failed": UserAngelOneAuthFailed;
  "market:phase": MarketPhaseEvent;
  "paper:interest_changed": PaperInterestChanged;
};

type Listener<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

class TypedBus {
  private emitter = new EventEmitter();

  on<K extends keyof BusEvents>(event: K, listener: Listener<K>): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  off<K extends keyof BusEvents>(event: K, listener: Listener<K>): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}

export const bus = new TypedBus();
