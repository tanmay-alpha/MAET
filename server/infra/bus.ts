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

export type MarketPhaseEvent = {
  phase: "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "AFTER_HOURS";
  ts: string;
};

export type BusEvents = {
  tick: Tick;
  "screener:match": ScreenerMatch;
  "order:fill": OrderFill;
  "user:angelone:ready": UserAngelOneReady;
  "market:phase": MarketPhaseEvent;
};

type Listener<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

class TypedBus {
  private emitter = new EventEmitter();

  on<K extends keyof BusEvents>(event: K, listener: Listener<K>): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof BusEvents>(event: K, listener: Listener<K>): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}

export const bus = new TypedBus();