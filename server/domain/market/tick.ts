import type { Tick } from "@shared/types";
import { AppError } from "@shared/types";

type AngelOneRaw = {
  last_traded_price: number | string;
  volume_traded_for_the_day: number | string;
  exchange_timestamp: string;
  best_bid_price?: number | string;
  best_ask_price?: number | string;
};

function toNum(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
}

export function normalize(raw: unknown, exchange: "NSE" | "BSE", symbol: string): Tick {
  if (!raw || typeof raw !== "object") {
    throw new AppError("VALIDATION_FAILED", "tick: not an object");
  }
  const r = raw as AngelOneRaw;
  const price = toNum(r.last_traded_price);
  const volume = toNum(r.volume_traded_for_the_day);
  if (price === undefined || price < 0) {
    throw new AppError("VALIDATION_FAILED", "tick: invalid price");
  }
  return {
    exchange,
    symbol,
    price,
    volume: volume ?? 0,
    ts: r.exchange_timestamp ?? new Date().toISOString(),
    bid: toNum(r.best_bid_price),
    ask: toNum(r.best_ask_price),
    source: "angelone",
  };
}

export function isStale(tick: Tick, now: Date, maxAgeMs: number): boolean {
  return now.getTime() - new Date(tick.ts).getTime() > maxAgeMs;
}
