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
import { registerCheck } from "./infra/health";
import { hydrateAngelOneCompanyTokens } from "./data/sources/nse-company-master";

// Yahoo quotes are delayed and do not benefit from tick-grade polling. A
// one-minute cadence avoids unnecessary upstream throttling on the free service.
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
const ANGEL_FEED_USER = "render-market-feed";

function activeAngelTokens(): string[] {
  return [...subscriptionRefs.keys()].flatMap((symbol) => {
    const record = lookupSymbol("NSE", symbol);
    return record ? [record.token] : [];
  });
}

function scheduleAngelLogin(delayMs = 60_000): void {
  if (!started || angelRetryTimer) return;
  angelRetryTimer = setTimeout(() => {
    angelRetryTimer = undefined;
    void connectAngelOne();
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Daily processor cron — runs at 18:30 IST (13:00 UTC) on weekdays
// ---------------------------------------------------------------------------

let dailyProcessorTimer: ReturnType<typeof setInterval> | undefined;

function shouldRunDailyProcessor(now: Date): boolean {
  const day = now.getDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  // 18:30 IST = 13:00 UTC (IST is UTC+5:30)
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
  }, 60_000); // check every minute
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
    registerCheck("angelone", true, "authenticated; stream connecting");
  } catch (error) {
    registerCheck("angelone", false, `login failed: ${(error as Error).message}`);
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
  angelReadyOff = bus.on("user:angelone:ready", ({ userId }) => {
    if (userId === ANGEL_FEED_USER) registerCheck("angelone", true, "live stream connected");
  });
  angelFailedOff = bus.on("user:angelone:auth_failed", ({ userId, reason }) => {
    if (userId !== ANGEL_FEED_USER) return;
    registerCheck("angelone", false, reason);
    scheduleAngelLogin(5_000);
  });
  angelOne.start();
  void connectAngelOne();
  scheduleDailyProcessor();
  void hydrateAngelOneCompanyTokens()
    .then((count) => {
      registerCheck("instrumentMaster", count >= 1_000, `${count} NSE equity tokens loaded`);
      syncAngelSubscriptions();
    })
    .catch((error) => registerCheck("instrumentMaster", false, (error as Error).message));
}

export async function stopOrchestrator(): Promise<void> {
  if (!started) return;
  started = false;
  yahooPoller.stop();
  if (angelRetryTimer) clearTimeout(angelRetryTimer);
  angelRetryTimer = undefined;
  if (dailyProcessorTimer) clearInterval(dailyProcessorTimer);
  dailyProcessorTimer = undefined;
  angelReadyOff?.();
  angelReadyOff = undefined;
  angelFailedOff?.();
  angelFailedOff = undefined;
  await angelOne.stop();
  setAngelOneMarketSession(undefined);
  screenerRunner.stop();
  orderMatcher.stop();
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
  syncAngelSubscriptions();
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
    syncAngelSubscriptions();
  };
}
