import type { MarketDataQuality, MarketPhase, MarketQuote, Tick } from "@shared/types";
import { getConfig } from "../../config";
import { computePhase, istDateKey } from "./clock";

export function configuredHolidays(): Date[] {
  try {
    return getConfig().nseHolidays;
  } catch {
    return [];
  }
}

export function currentMarketPhase(now: Date = new Date(), holidays: Date[] = configuredHolidays()): MarketPhase {
  return computePhase(now, holidays);
}

/**
 * A provider can only call a quote "live" while the cash session is open and
 * the quote belongs to today's session. A broker snapshot after the close, or
 * yesterday's last trade served from cache, is the last known price, not a
 * live one. Non-live qualities (delayed/stale/synthetic) pass through.
 */
export function sessionQuality(
  tick: Pick<Tick, "quality" | "ts">,
  now: Date,
  phase: MarketPhase
): MarketDataQuality {
  if (tick.quality !== "live") return tick.quality;
  if (phase !== "OPEN") return "delayed";
  const quoteTime = new Date(tick.ts);
  if (Number.isNaN(quoteTime.getTime()) || istDateKey(quoteTime) !== istDateKey(now)) return "delayed";
  return "live";
}

export function toMarketQuote(
  tick: Tick,
  now: Date = new Date(),
  phase: MarketPhase = currentMarketPhase(now)
): MarketQuote {
  const quality = sessionQuality(tick, now, phase);
  return { ...tick, quality, delayed: quality !== "live" };
}
