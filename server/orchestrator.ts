import { CandleWriter } from "./workers/candle-writer";
import { MarketClockWorker } from "./workers/market-clock";
import { ScreenerRunner } from "./workers/screener-runner";
import { AngelOneWorker } from "./workers/angelone-ws";
import { OrderMatcherWorker } from "./workers/order-matcher";
import { DailyProcessorSchedule } from "./workers/daily-processor-schedule";
import { quoteStore } from "./domain/market/quote-store";
import { nextIstTime } from "./domain/market/clock";
import { configuredHolidays } from "./domain/market/quote-quality";
import { closeRedis, setnxWithTtl } from "./data/redis/client";
import { RedisKeys } from "./data/redis/keys";
import { login, onAngelOneSessionRejected, setAngelOneMarketSession } from "./data/sources/angelone/client";
import { getConfig } from "./config";
import { lookupSymbol } from "./domain/market/symbol";
import { bus } from "./infra/bus";
import { updateHealthStatus } from "./infra/health";
import { getLogger } from "./infra/logger";
import { hydrateAngelOneCompanyTokens } from "./data/sources/nse-company-master";
import { marketDataMultiplexer } from "./domain/market/data-multiplexer";

import { alertEvaluatorWorker } from "./workers/alert-evaluator";
import { listActiveAlertSymbols } from "./modules/alerts/repository";

const angelOne = new AngelOneWorker();
const candleWriter = new CandleWriter();
const marketClock = new MarketClockWorker();
const screenerRunner = new ScreenerRunner();
const orderMatcher = new OrderMatcherWorker();
const subscriptionRefs = new Map<string, number>();
const alertSubscriptionSymbols = new Set<string>();
let started = false;
let angelRetryTimer: ReturnType<typeof setTimeout> | undefined;
let angelDailyLoginTimer: ReturnType<typeof setTimeout> | undefined;
let angelLoginInFlight: Promise<void> | undefined;
let angelReadyOff: (() => void) | undefined;
let angelFailedOff: (() => void) | undefined;
let angelRejectedOff: (() => void) | undefined;
let quoteBusOff: (() => void) | undefined;
let alertReconcileTimer: ReturnType<typeof setInterval> | undefined;
const ANGEL_FEED_USER = "render-market-feed";
// Angel One sessions do not survive the night; log in fresh before pre-open (09:00 IST).
const ANGEL_DAILY_LOGIN_IST = { hour: 8, minute: 30 };
const DAILY_PROCESSOR_LOCK_TTL_SECONDS = 2 * 24 * 60 * 60;

function log() {
  return getLogger().child({ module: "orchestrator" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activeAngelTokens(): string[] {
  const tokens = new Set<string>();
  for (const symbol of subscriptionRefs.keys()) {
    const info = lookupSymbol("NSE", symbol) ?? lookupSymbol("BSE", symbol);
    if (info?.token) tokens.add(String(info.token));
  }
  return Array.from(tokens);
}

function scheduleAngelLogin(delayMs = 15_000): void {
  clearTimeout(angelRetryTimer);
  angelRetryTimer = setTimeout(() => {
    angelRetryTimer = undefined;
    if (started) void connectAngelOne();
  }, delayMs);
}

function scheduleDailyAngelLogin(): void {
  clearTimeout(angelDailyLoginTimer);
  const at = nextIstTime(new Date(), ANGEL_DAILY_LOGIN_IST.hour, ANGEL_DAILY_LOGIN_IST.minute);
  angelDailyLoginTimer = setTimeout(() => {
    angelDailyLoginTimer = undefined;
    if (!started) return;
    log().info("scheduled Angel One re-login before the session");
    void connectAngelOne();
    scheduleDailyAngelLogin();
  }, at.getTime() - Date.now());
}

let dailyProcessorTimer: ReturnType<typeof setInterval> | undefined;
const dailyProcessor = new DailyProcessorSchedule({
  acquireLock: (istDate) =>
    setnxWithTtl(RedisKeys.dailyProcessorLockKey(istDate), String(process.pid), DAILY_PROCESSOR_LOCK_TTL_SECONDS),
  holidays: configuredHolidays,
  onLockError: (error) =>
    log().warn({ err: errorMessage(error) }, "daily processor lock unavailable; running without cross-instance guard"),
  run: async () => {
    log().info("running daily processor");
    const { runDailyProcessor } = await import("./workers/daily-processor");
    const stats = await runDailyProcessor({ backfillDays: 365 });
    log().info({ stats }, "daily processor finished");
  },
});

function scheduleDailyProcessor(): void {
  if (dailyProcessorTimer) return;
  dailyProcessorTimer = setInterval(() => {
    dailyProcessor.tick().catch((error) => log().error({ err: errorMessage(error) }, "daily processor failed"));
  }, 60_000);
}

/** Single-flight: the retry timer, the daily re-login and a 401 can all ask at once. */
function connectAngelOne(): Promise<void> {
  angelLoginInFlight ??= loginAngelOne().finally(() => {
    angelLoginInFlight = undefined;
  });
  return angelLoginInFlight;
}

async function loginAngelOne(): Promise<void> {
  try {
    const config = getConfig();
    if (!config.angeloneApiKey || !config.angeloneClientId || !config.angelonePin || !config.angeloneTotpSecret) {
      log().warn("Angel One credentials not configured; live market data disabled");
      updateHealthStatus("marketData", false);
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
    // Error text comes from our client (status codes, provider error codes), never credentials.
    log().error({ err: errorMessage(error) }, "Angel One login failed; retrying");
    updateHealthStatus("marketData", false);
    scheduleAngelLogin();
  }
}

function syncAngelSubscriptions(): void {
  angelOne.updateTokens(ANGEL_FEED_USER, activeAngelTokens());
}

export async function reconcileAlertSubscriptions(fetchActiveSymbols = listActiveAlertSymbols): Promise<void> {
  try {
    const activeSymbols = await fetchActiveSymbols();
    const currentActive = new Set(activeSymbols.map((s) => s.toUpperCase()));

    // 1. Subscribe newly active symbols
    for (const s of currentActive) {
      if (!alertSubscriptionSymbols.has(s)) {
        subscribeSymbol(s);
        alertSubscriptionSymbols.add(s);
      }
    }

    // 2. Unsubscribe symbols no longer backed by active alerts
    for (const s of alertSubscriptionSymbols) {
      if (!currentActive.has(s)) {
        unsubscribeSymbol(s);
        alertSubscriptionSymbols.delete(s);
      }
    }
  } catch (err) {
    console.error("[Orchestrator] Alert subscription reconciliation failed:", err);
  }
}

export function startOrchestrator(): void {
  if (started) return;
  started = true;
  quoteStore.start();
  candleWriter.start();
  marketClock.start();
  screenerRunner.start();
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
  angelRejectedOff = onAngelOneSessionRejected((reason) => {
    log().warn({ reason }, "Angel One rejected the session; logging in again");
    updateHealthStatus("marketData", false);
    scheduleAngelLogin(1_000);
  });
  quoteBusOff = bus.on("tick", (tick) => {
    void alertEvaluatorWorker.processQuote({
      symbol: tick.symbol,
      price: tick.price,
      previousClose: tick.previousClose,
      changePct: tick.changePct,
      volume: tick.volume,
      quoteTimestamp: new Date(tick.ts).getTime(),
      source: tick.source,
    });
  });
  angelOne.start();
  void connectAngelOne();
  scheduleDailyAngelLogin();
  scheduleDailyProcessor();

  // Reconcile alert symbol subscriptions immediately and periodically
  void reconcileAlertSubscriptions();
  if (!alertReconcileTimer) {
    alertReconcileTimer = setInterval(() => {
      void reconcileAlertSubscriptions();
    }, 10_000);
  }

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
  if (angelRetryTimer) {
    clearTimeout(angelRetryTimer);
    angelRetryTimer = undefined;
  }
  if (angelDailyLoginTimer) {
    clearTimeout(angelDailyLoginTimer);
    angelDailyLoginTimer = undefined;
  }
  if (dailyProcessorTimer) {
    clearInterval(dailyProcessorTimer);
    dailyProcessorTimer = undefined;
  }
  if (alertReconcileTimer) {
    clearInterval(alertReconcileTimer);
    alertReconcileTimer = undefined;
  }
  angelReadyOff?.();
  angelFailedOff?.();
  angelRejectedOff?.();
  quoteBusOff?.();
  await alertEvaluatorWorker.stop();

  // Release alert-owned subscription references
  for (const s of alertSubscriptionSymbols) {
    unsubscribeSymbol(s);
  }
  alertSubscriptionSymbols.clear();

  angelOne.stop();
  orderMatcher.stop();
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

// Test/inspection helpers
export function getSubscriptionRefCount(symbol: string): number {
  return subscriptionRefs.get(symbol.toUpperCase()) ?? 0;
}

export function getAlertSubscriptionSymbols(): string[] {
  return Array.from(alertSubscriptionSymbols);
}

export function resetSubscriptionRefsForTesting(): void {
  subscriptionRefs.clear();
  alertSubscriptionSymbols.clear();
}
