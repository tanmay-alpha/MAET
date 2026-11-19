import { afterEach, describe, expect, it } from "bun:test";
import { MAX_STREAM_SYMBOLS, type Tick } from "@shared/types";
import {
  activeAngelTokens,
  reconcileAlertSubscriptions,
  resetSubscriptionRefsForTesting,
  subscribeMarketSymbols,
  subscribeSymbol,
  unsubscribeSymbol,
} from "../orchestrator";
import { ANGEL_ONE_MAX_TOKENS_PER_SESSION } from "./angelone-ws";
import { OrderMatcherWorker } from "./order-matcher";
import { registerMarketSymbols } from "../domain/market/symbol";
import { paperTradingTickProcessor } from "../modules/paper-trading/tick-processor";
import { bus } from "../infra/bus";

/** Catalogued NSE symbols with distinct feed tokens: FEEDBUDGET0 has token 600000, and so on. */
const UNIVERSE = 2_400;
const symbolAt = (index: number) => `FEEDBUDGET${index}`;
const tokenOf = (index: number) => String(600_000 + index);
registerMarketSymbols(Array.from({ length: UNIVERSE }, (_, index) => ({
  exchange: "NSE" as const,
  symbol: symbolAt(index),
  name: symbolAt(index),
  token: tokenOf(index),
  yahooTicker: `${symbolAt(index)}.NS`,
  isActive: true,
})));

afterEach(() => resetSubscriptionRefsForTesting());

/** Opens market-stream connections of at most MAX_STREAM_SYMBOLS symbols each, like many anonymous tabs. */
function openStreams(symbols: string[]): Array<() => void> {
  const releases: Array<() => void> = [];
  for (let start = 0; start < symbols.length; start += MAX_STREAM_SYMBOLS) {
    releases.push(subscribeMarketSymbols(symbols.slice(start, start + MAX_STREAM_SYMBOLS)));
  }
  return releases;
}

describe("Angel One token budget", () => {
  it("keeps 2,000 anonymously streamed symbols within the session budget without evicting paper or alert symbols", async () => {
    const streamed = Array.from({ length: 2_000 }, (_, index) => symbolAt(index));
    const releases = openStreams(streamed);
    expect(activeAngelTokens()).toHaveLength(ANGEL_ONE_MAX_TOKENS_PER_SESSION);

    // Paper interest and alerts arrive after the stream already filled the budget.
    const paper = [symbolAt(2_100), symbolAt(2_101), symbolAt(1_999)];
    for (const symbol of paper) subscribeSymbol(symbol, "paper");
    const alerts = [symbolAt(2_200), symbolAt(1_500)];
    await reconcileAlertSubscriptions(async () => alerts);

    const tokens = activeAngelTokens();
    expect(tokens.length).toBeLessThanOrEqual(ANGEL_ONE_MAX_TOKENS_PER_SESSION);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens.slice(0, paper.length)).toEqual([tokenOf(2_100), tokenOf(2_101), tokenOf(1_999)]);
    expect(tokens.slice(paper.length, paper.length + alerts.length)).toEqual([tokenOf(2_200), tokenOf(1_500)]);
    // Stream viewers that subscribed first keep their slots; the latest ones gave way.
    expect(tokens).toContain(tokenOf(0));
    expect(tokens).not.toContain(tokenOf(999));

    // Every viewer leaves: only the priority symbols stay subscribed.
    for (const release of releases) release();
    expect(new Set(activeAngelTokens())).toEqual(new Set([...paper, ...alerts].map((symbol) => tokenOf(Number(symbol.slice(10))))));
  });

  it("holds the budget and the paper/alert priority across seeded random subscription churn", async () => {
    let seed = 0xfeed;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % limit;
    };
    const open: Array<() => void> = [];
    const paper = new Set<string>();
    let alerts: string[] = [];

    for (let step = 0; step < 400; step++) {
      const action = random(10);
      if (action < 4) {
        const size = 1 + random(MAX_STREAM_SYMBOLS);
        const offset = random(UNIVERSE);
        open.push(subscribeMarketSymbols(Array.from({ length: size }, (_, i) => symbolAt((offset + i) % UNIVERSE))));
      } else if (action < 6 && open.length > 0) {
        open.splice(random(open.length), 1)[0]!();
      } else if (action < 8) {
        const symbol = symbolAt(random(UNIVERSE));
        if (paper.has(symbol)) {
          unsubscribeSymbol(symbol, "paper");
          paper.delete(symbol);
        } else if (paper.size < MAX_STREAM_SYMBOLS) {
          subscribeSymbol(symbol, "paper");
          paper.add(symbol);
        }
      } else {
        alerts = Array.from({ length: random(60) }, () => symbolAt(random(UNIVERSE)));
        await reconcileAlertSubscriptions(async () => alerts);
      }

      const tokens = new Set(activeAngelTokens());
      expect(tokens.size).toBeLessThanOrEqual(ANGEL_ONE_MAX_TOKENS_PER_SESSION);
      // Paper (at most MAX_STREAM_SYMBOLS) plus alerts always fit, so none of them is ever dropped.
      for (const symbol of [...paper, ...alerts]) expect(tokens.has(tokenOf(Number(symbol.slice(10))))).toBe(true);
    }
    for (const release of open) release();
  });
});

function liveTick(symbol: string): Tick {
  return { exchange: "NSE", symbol, price: 101, volume: 5_000, ts: new Date().toISOString(), source: "angelone", quality: "live" };
}

describe("order matcher pre-database short-circuit", () => {
  it("skips matching (and its paper_orders query) for symbols without a working order, but keeps the volume baseline", async () => {
    const processed: string[] = [];
    const observed: string[] = [];
    const realProcess = paperTradingTickProcessor.processTick;
    const realObserve = paperTradingTickProcessor.observeTick;
    paperTradingTickProcessor.processTick = async (tick) => {
      processed.push(tick.symbol);
      return [];
    };
    paperTradingTickProcessor.observeTick = (tick) => {
      observed.push(tick.symbol);
    };
    const working: Record<string, true> = { "NSE:FEEDBUDGET1": true };
    const matcher = new OrderMatcherWorker({ hasWorkingOrders: (exchange, symbol) => Object.hasOwn(working, `${exchange}:${symbol}`) });
    try {
      matcher.start();
      bus.emit("tick", liveTick("FEEDBUDGET0"));
      bus.emit("tick", liveTick("FEEDBUDGET1"));
      // Delayed quotes never reach matching either way.
      bus.emit("tick", { ...liveTick("FEEDBUDGET1"), source: "yahoo", quality: "delayed" });
      await Promise.resolve();
      expect(processed).toEqual(["FEEDBUDGET1"]);
      expect(observed).toEqual(["FEEDBUDGET0"]);
    } finally {
      matcher.stop();
      paperTradingTickProcessor.processTick = realProcess;
      paperTradingTickProcessor.observeTick = realObserve;
    }
  });
});
