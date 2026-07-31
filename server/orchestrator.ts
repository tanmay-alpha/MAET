import { CandleWriter } from "./workers/candle-writer";
import { MarketClockWorker } from "./workers/market-clock";
import { ScreenerRunner } from "./workers/screener-runner";
import { YahooPoller } from "./workers/yahoo-poller";
import { AngelOneWorker } from "./workers/angelone-ws";
import { OrderMatcherWorker } from "./workers/order-matcher";
import { quoteStore } from "./domain/market/quote-store";
import { closeRedis } from "./data/redis/client";
import { login, setAngelOneMarketSession } from "./data/sources/angelone/client";
import { getConfig } from "./config";
import { lookupSymbol } from "./domain/market/symbol";
import { bus } from "./infra/bus";
import { updateHealthStatus } from "./infra/health";
import { hydrateAngelOneCompanyTokens } from "./data/sources/nse-company-master";
import { marketDataMultiplexer } from "./domain/market/data-multiplexer";

import { alertEvaluatorWorker } from "./workers/alert-evaluator";

const yahooPoller = new YahooPoller({ intervalMs: 60_000 });
const angelOne = new AngelOneWorker();
const candleWriter = new CandleWriter();
const marketClock = new MarketClockWorker();
const screenerRunner = new ScreenerRunner();
const orderMatcher = new OrderMatcherWorker();
const subscriptionRefs = new Map<string, number>();
let started = false;
let angelRetryTimer: ReturnType<typeof setTimeout> | undefined;
let angelReadyOff: (() => void) | undefined;
let angelFailedOff: (() => void) | undefined;
let quoteBusOff: (() => void) | undefined;
const ANGEL_FEED_USER = "render-market-feed";

function activeAngelTokens(): string[] {
  const tokens = new Set<string>();
  for (const symbol of subscriptionRefs.keys()) {
    const info = lookupSymbol("NSE", symbol) ?? lookupSymbol("BSE", symbol);
    if (info?.token) tokens.add(String(info.token));
  }
  return Array.from(tokens);
}

function scheduleAngelLogin(delayMs = 15_000): void {
  if (angelRetryTimer) clearTimeout(angelRetryTimer);
  angelRetryTimer = setTimeout(() => {
    angelRetryTimer = undefined;
    if (started) void connectAngelOne();
  }, delayMs);
}

let dailyProcessorTimer: ReturnType<typeof setInterval> | undefined;

function shouldRunDailyProcessor(now: Date): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();
  return hour === 13 && min === 0;
}

let lastProcessorRunDate = "";

function scheduleDailyProcessor(): void {
  if (dailyProcessorTimer) return;
  dailyProcessorTimer = setInterval(async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (shouldRunDailyProcessor(now) && lastProcessorRunDate !== today) {
      lastProcessorRunDate = today;
      console.log("[cron] running daily processor at", now.toISOString());
      try {
        const { runDailyProcessor } = await import("./workers/daily-processor");
        const stats = await runDailyProcessor({ backfillDays: 365 });
        console.log("[cron] daily processor finished:", stats);
      } catch (e) {
        console.error("[cron] daily processor failed:", e);
      }
    }
  }, 60_000);
}

async function connectAngelOne(): Promise<void> {
  try {
    const config = getConfig();
    if (!config.angeloneApiKey || !config.angeloneClientId || !config.angelonePin || !config.angeloneTotpSecret) {
      console.warn("Angel One credentials not configured, skipping login");
      return;
    }
    const session = await login({
      apiKey: config.angeloneApiKey,
      clientCode: config.angeloneClientId,
      password: config.angelonePin,
      totpSecret: config.angeloneTotpSecret,
    });
    if (!started) return;
    setAngelOneMarketSession(session);
    angelOne.manageUser(ANGEL_FEED_USER, session, activeAngelTokens());
    updateHealthStatus("marketData", true);
  } catch (error) {
    updateHealthStatus("marketData", false);
    scheduleAngelLogin();
  }
}

function syncAngelSubscriptions(): void {
  angelOne.updateTokens(ANGEL_FEED_USER, activeAngelTokens());
}

export function startOrchestrator(): void {
  if (started) return;
  started = true;
  quoteStore.start();
  candleWriter.start();
  marketClock.start();
  screenerRunner.start();
  yahooPoller.start();
  orderMatcher.start();
  void alertEvaluatorWorker.start();
  marketDataMultiplexer.start();
  angelReadyOff = bus.on("user:angelone:ready", ({ userId }) => {
    if (userId === ANGEL_FEED_USER) updateHealthStatus("marketData", true);
  });
  angelFailedOff = bus.on("user:angelone:auth_failed", ({ userId }) => {
    if (userId !== ANGEL_FEED_USER) return;
    updateHealthStatus("marketData", false);
    scheduleAngelLogin(5_000);
  });
  quoteBusOff = bus.on("tick", (tick) => {
    void alertEvaluatorWorker.processQuote({
      symbol: tick.symbol,
      price: tick.price,
      previousClose: tick.previousClose ?? tick.price,
      volume: tick.volume,
      quoteTimestamp: new Date(tick.ts).getTime(),
      source: tick.source,
    });
  });
  angelOne.start();
  void connectAngelOne();
  scheduleDailyProcessor();

  void (async () => {
    try {
      await hydrateAngelOneCompanyTokens();
      syncAngelSubscriptions();
    } catch (e) {
      console.error("[Orchestrator] NSE company master token hydration failed:", e);
    }
  })();
}

export async function stopOrchestrator(): Promise<void> {
  if (!started) return;
  started = false;
  if (angelRetryTimer) clearTimeout(angelRetryTimer);
  if (dailyProcessorTimer) clearInterval(dailyProcessorTimer);
  angelReadyOff?.();
  angelFailedOff?.();
  quoteBusOff?.();
  await alertEvaluatorWorker.stop();
  angelOne.stop();
  orderMatcher.stop();
  yahooPoller.stop();
  screenerRunner.stop();
  marketClock.stop();
  candleWriter.stop();
  quoteStore.stop();
  marketDataMultiplexer.stop();
  await closeRedis();
}

export function subscribeSymbol(symbol: string): void {
  const s = symbol.toUpperCase();
  const count = subscriptionRefs.get(s) ?? 0;
  subscriptionRefs.set(s, count + 1);
  if (count === 0) {
    syncAngelSubscriptions();
  }
}

export function unsubscribeSymbol(symbol: string): void {
  const s = symbol.toUpperCase();
  const count = subscriptionRefs.get(s) ?? 0;
  if (count <= 1) {
    subscriptionRefs.delete(s);
    syncAngelSubscriptions();
  } else {
    subscriptionRefs.set(s, count - 1);
  }
}

export function subscribeMarketSymbols(symbols: string[]): () => void {
  for (const s of symbols) {
    subscribeSymbol(s);
  }
  return () => {
    for (const s of symbols) {
      unsubscribeSymbol(s);
    }
  };
}
