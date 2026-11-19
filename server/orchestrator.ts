import { CandleWriter } from "./workers/candle-writer";
import { MarketClockWorker } from "./workers/market-clock";
import { ScreenerRunner } from "./workers/screener-runner";
import { ANGEL_ONE_MAX_TOKENS_PER_SESSION, AngelOneWorker } from "./workers/angelone-ws";
import { OrderMatcherWorker } from "./workers/order-matcher";
import { DAILY_PROCESSOR_LOCK_TTL_MS, DailyProcessorSchedule } from "./workers/daily-processor-schedule";
import { ReloginBackoff } from "./workers/relogin-backoff";
import { quoteStore } from "./domain/market/quote-store";
import { hasHolidaysForIstYear, nextIstTime } from "./domain/market/clock";
import { configuredHolidays } from "./domain/market/quote-quality";
import { keyExists, setnxWithTtl } from "./data/redis/client";
import { RedisKeys } from "./data/redis/keys";
import { login, onAngelOneSessionRejected, setAngelOneMarketSession } from "./data/sources/angelone/client";
import { getConfig } from "./config";
import { lookupSymbol } from "./domain/market/symbol";
import { bus } from "./infra/bus";
import { updateHealthStatus } from "./infra/health";
import { getLogger } from "./infra/logger";
import { hydrateAngelOneCompanyTokens } from "./data/sources/nse-company-master";
import { marketDataMultiplexer } from "./domain/market/data-multiplexer";

import type { Tick } from "@shared/types";
import { alertEvaluatorWorker } from "./workers/alert-evaluator";
import type { QuoteSnapshot } from "./modules/alerts/evaluator";
import { listActiveAlertSymbols } from "./modules/alerts/repository";
import { startOutboxPublisherWorker, stopOutboxPublisherWorker } from "./workers/paper-outbox-publisher";
import { listPaperInterest, PaperInterestSubscriptions } from "./modules/paper-trading/interest-subscriptions";

/**
 * Who asked for a symbol on the live feed. The Angel One session takes at most
 * ANGEL_ONE_MAX_TOKENS_PER_SESSION tokens; when demand exceeds that, paper trading
 * (resting orders must see ticks to fill; positions are margin-monitored) goes first,
 * then price alerts, then anonymous market-stream viewers in the order they subscribed.
 * A viewer whose symbol misses the budget still has the REST quote poll.
 */
export type FeedSource = "paper" | "alert" | "stream";
const FEED_PRIORITY: readonly FeedSource[] = ["paper", "alert", "stream"];

const angelOne = new AngelOneWorker();
const candleWriter = new CandleWriter();
const marketClock = new MarketClockWorker();
const screenerRunner = new ScreenerRunner();
/** EXCHANGE:SYMBOL with a working paper order (current generations), from the last paper-interest read. */
let workingOrderKeys = new Set<string>();
const orderMatcher = new OrderMatcherWorker({
  hasWorkingOrders: (exchange, symbol) => workingOrderKeys.has(`${exchange}:${symbol}`),
});
/** Reference counts per source; Map order is first-subscription order (the tie-break within a source). */
const subscriptionRefs: Record<FeedSource, Map<string, number>> = {
  paper: new Map(),
  alert: new Map(),
  stream: new Map(),
};
let started = false;
let angelRetryTimer: ReturnType<typeof setTimeout> | undefined;
let angelDailyLoginTimer: ReturnType<typeof setTimeout> | undefined;
let angelLoginInFlight: Promise<void> | undefined;
let angelReadyOff: (() => void) | undefined;
let angelFailedOff: (() => void) | undefined;
let angelRejectedOff: (() => void) | undefined;
let quoteBusOff: (() => void) | undefined;
let alertReconcileTimer: ReturnType<typeof setInterval> | undefined;
let paperInterestOff: (() => void) | undefined;
const ANGEL_FEED_USER = "render-market-feed";
// Angel One sessions do not survive the night; log in fresh before pre-open (09:00 IST).
const ANGEL_DAILY_LOGIN_IST = { hour: 8, minute: 30 };
const DAILY_PROCESSOR_DONE_TTL_SECONDS = 2 * 24 * 60 * 60;
const reloginBackoff = new ReloginBackoff();

function log() {
  return getLogger().child({ module: "orchestrator" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Keeps symbols with working paper orders or open positions on the live feed,
// so resting orders can fill and positions are marked without any viewer.
const paperInterest = new PaperInterestSubscriptions({
  subscribe: (symbol) => subscribeSymbol(symbol, "paper"),
  unsubscribe: (symbol) => unsubscribeSymbol(symbol, "paper"),
  // The same read also tells the order matcher which symbols can have a resting order to match.
  fetchInterest: async () => {
    const rows = await listPaperInterest();
    workingOrderKeys = new Set(
      rows
        .filter((row) => row.kind === "ORDER")
        .map((row) => `${row.exchange.trim().toUpperCase()}:${row.symbol.trim().toUpperCase()}`)
    );
    return rows;
  },
  log: {
    info: (fields, message) => log().info(fields, message),
    warn: (fields, message) => log().warn(fields, message),
    debug: (fields, message) => log().debug(fields, message),
  },
});

/** Feed tokens in priority order, at most ANGEL_ONE_MAX_TOKENS_PER_SESSION of them (what the Angel One session subscribes). */
export function activeAngelTokens(): string[] {
  const tokens = new Set<string>();
  for (const source of FEED_PRIORITY) {
    for (const symbol of subscriptionRefs[source].keys()) {
      if (tokens.size >= ANGEL_ONE_MAX_TOKENS_PER_SESSION) return Array.from(tokens);
      const info = lookupSymbol("NSE", symbol) ?? lookupSymbol("BSE", symbol);
      if (info?.token) tokens.add(String(info.token));
    }
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
    setnxWithTtl(RedisKeys.dailyProcessorLockKey(istDate), String(process.pid), DAILY_PROCESSOR_LOCK_TTL_MS / 1000),
  isCompleted: (istDate) => keyExists(RedisKeys.dailyProcessorDoneKey(istDate)),
  markCompleted: async (istDate) => {
    await setnxWithTtl(RedisKeys.dailyProcessorDoneKey(istDate), String(process.pid), DAILY_PROCESSOR_DONE_TTL_SECONDS);
  },
  holidays: configuredHolidays,
  onLockError: (error) =>
    log().warn({ err: errorMessage(error) }, "daily processor Redis guard unavailable; running without cross-instance guard"),
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
    const alertRefs = subscriptionRefs.alert;
    let changed = false;

    // 1. Subscribe newly active symbols (one alert reference per symbol)
    for (const s of currentActive) {
      if (!alertRefs.has(s)) changed = addRef(s, "alert") || changed;
    }

    // 2. Unsubscribe symbols no longer backed by active alerts
    for (const s of [...alertRefs.keys()]) {
      if (!currentActive.has(s)) changed = removeRef(s, "alert") || changed;
    }
    if (changed) syncAngelSubscriptions();
  } catch (err) {
    console.error("[Orchestrator] Alert subscription reconciliation failed:", err);
  }
}

/**
 * Runs per-tick alert evaluation without letting a rejection (e.g. a Postgres hiccup while
 * loading alerts) escape the bus handler as an unhandled rejection. Only symbols with an
 * active alert (as of the last reconcile, every 10 s) reach the database: every other
 * streamed symbol would otherwise cost an alerts query per tick.
 */
export async function evaluateTickAlerts(
  tick: Tick,
  processQuote: (quote: QuoteSnapshot) => Promise<unknown> = (quote) => alertEvaluatorWorker.processQuote(quote),
): Promise<void> {
  if (!subscriptionRefs.alert.has(tick.symbol.toUpperCase())) return;
  try {
    await processQuote({
      symbol: tick.symbol,
      price: tick.price,
      previousClose: tick.previousClose,
      changePct: tick.changePct,
      volume: tick.volume,
      quoteTimestamp: new Date(tick.ts).getTime(),
      source: tick.source,
    });
  } catch (error) {
    log().error({ symbol: tick.symbol, err: errorMessage(error) }, "alert evaluation failed for tick");
  }
}

export function startOrchestrator(): void {
  if (started) return;
  started = true;
  if (!hasHolidaysForIstYear(configuredHolidays(), new Date())) {
    log().warn("no NSE holidays configured for the current IST year; holidays will be treated as trading days");
  }
  quoteStore.start();
  candleWriter.start();
  marketClock.start();
  screenerRunner.start();
  orderMatcher.start();
  startOutboxPublisherWorker();
  paperInterest.start();
  paperInterestOff = bus.on("paper:interest_changed", () => paperInterest.requestRefresh());
  void alertEvaluatorWorker.start();
  marketDataMultiplexer.start();
  angelReadyOff = bus.on("user:angelone:ready", ({ userId }) => {
    if (userId === ANGEL_FEED_USER) updateHealthStatus("marketData", true);
  });
  angelFailedOff = bus.on("user:angelone:auth_failed", ({ userId, reason }) => {
    if (userId !== ANGEL_FEED_USER) return;
    const delayMs = reloginBackoff.next(Date.now());
    log().warn({ reason, delayMs }, "Angel One stream auth failed; logging in again");
    updateHealthStatus("marketData", false);
    scheduleAngelLogin(delayMs);
  });
  angelRejectedOff = onAngelOneSessionRejected((reason) => {
    const delayMs = reloginBackoff.next(Date.now());
    log().warn({ reason, delayMs }, "Angel One rejected the session; logging in again");
    updateHealthStatus("marketData", false);
    scheduleAngelLogin(delayMs);
  });
  quoteBusOff = bus.on("tick", (tick) => {
    void evaluateTickAlerts(tick);
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
  paperInterestOff?.();
  paperInterestOff = undefined;

  // No new fills, then let a claimed outbox batch commit before connections close.
  orderMatcher.stop();
  await stopOutboxPublisherWorker();
  await alertEvaluatorWorker.stop();

  // Release the feed subscriptions owned by alerts and paper trading.
  if (subscriptionRefs.alert.size > 0) {
    subscriptionRefs.alert.clear();
    syncAngelSubscriptions();
  }
  paperInterest.stop();
  workingOrderKeys = new Set();

  await angelOne.stop();
  screenerRunner.stop();
  marketClock.stop();
  candleWriter.stop();
  quoteStore.stop();
  marketDataMultiplexer.stop();
}

/** Adds one reference; true when the symbol is new for this source (the token order may change). */
function addRef(symbol: string, source: FeedSource): boolean {
  const s = symbol.toUpperCase();
  const refs = subscriptionRefs[source];
  const count = refs.get(s) ?? 0;
  refs.set(s, count + 1);
  return count === 0;
}

/** Drops one reference; true when the source no longer holds the symbol. */
function removeRef(symbol: string, source: FeedSource): boolean {
  const s = symbol.toUpperCase();
  const refs = subscriptionRefs[source];
  const count = refs.get(s);
  if (count === undefined) return false;
  if (count > 1) {
    refs.set(s, count - 1);
    return false;
  }
  refs.delete(s);
  return true;
}

export function subscribeSymbol(symbol: string, source: FeedSource = "stream"): void {
  if (addRef(symbol, source)) syncAngelSubscriptions();
}

export function unsubscribeSymbol(symbol: string, source: FeedSource = "stream"): void {
  if (removeRef(symbol, source)) syncAngelSubscriptions();
}

/** A market-stream connection's symbols; one feed update for the whole set, and one on release. */
export function subscribeMarketSymbols(symbols: string[]): () => void {
  let changed = false;
  for (const s of symbols) changed = addRef(s, "stream") || changed;
  if (changed) syncAngelSubscriptions();
  return () => {
    let released = false;
    for (const s of symbols) released = removeRef(s, "stream") || released;
    if (released) syncAngelSubscriptions();
  };
}

// Test/inspection helpers
/** References on a symbol across every source. */
export function getSubscriptionRefCount(symbol: string): number {
  const s = symbol.toUpperCase();
  return FEED_PRIORITY.reduce((total, source) => total + (subscriptionRefs[source].get(s) ?? 0), 0);
}

export function getAlertSubscriptionSymbols(): string[] {
  return Array.from(subscriptionRefs.alert.keys());
}

/** Re-reads working paper orders and open positions and updates their feed subscriptions. */
export function reconcilePaperInterestSubscriptions(): Promise<void> {
  return paperInterest.reconcile();
}

export function getPaperInterestSymbols(): string[] {
  return paperInterest.symbols();
}

export function resetSubscriptionRefsForTesting(): void {
  paperInterest.stop();
  for (const source of FEED_PRIORITY) subscriptionRefs[source].clear();
  workingOrderKeys = new Set();
}
