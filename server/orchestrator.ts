import { CandleWriter } from "./workers/candle-writer";
import { MarketClockWorker } from "./workers/market-clock";
import { ScreenerRunner } from "./workers/screener-runner";
import { YahooPoller } from "./workers/yahoo-poller";
import { quoteStore } from "./domain/market/quote-store";
import { closeRedis } from "./data/redis/client";

// Yahoo quotes are delayed and do not benefit from tick-grade polling. A
// one-minute cadence avoids unnecessary upstream throttling on the free service.
const yahooPoller = new YahooPoller({ intervalMs: 60_000 });
const candleWriter = new CandleWriter();
const marketClock = new MarketClockWorker();
const screenerRunner = new ScreenerRunner();
const subscriptionRefs = new Map<string, number>();
let started = false;

export function startOrchestrator(): void {
  if (started) return;
  started = true;
  quoteStore.start();
  candleWriter.start();
  marketClock.start();
  screenerRunner.start();
  yahooPoller.start();
}

export async function stopOrchestrator(): Promise<void> {
  if (!started) return;
  started = false;
  yahooPoller.stop();
  screenerRunner.stop();
  marketClock.stop();
  candleWriter.stop();
  quoteStore.stop();
  subscriptionRefs.clear();
  await closeRedis();
}

export function subscribeMarketSymbols(symbols: string[]): () => void {
  const normalized = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const newlySubscribed: string[] = [];

  for (const symbol of normalized) {
    const next = (subscriptionRefs.get(symbol) ?? 0) + 1;
    subscriptionRefs.set(symbol, next);
    if (next === 1) newlySubscribed.push(symbol);
  }
  if (newlySubscribed.length > 0) yahooPoller.subscribe(newlySubscribed);
  void yahooPoller.refresh();

  return () => {
    const unused: string[] = [];
    for (const symbol of normalized) {
      const next = Math.max(0, (subscriptionRefs.get(symbol) ?? 1) - 1);
      if (next === 0) {
        subscriptionRefs.delete(symbol);
        unused.push(symbol);
      } else {
        subscriptionRefs.set(symbol, next);
      }
    }
    if (unused.length > 0) yahooPoller.unsubscribe(unused);
  };
}
