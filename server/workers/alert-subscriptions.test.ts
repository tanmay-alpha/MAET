import { describe, expect, it, beforeEach } from "bun:test";
import type { Tick } from "@shared/types";
import {
  subscribeSymbol,
  unsubscribeSymbol,
  subscribeMarketSymbols,
  reconcileAlertSubscriptions,
  getSubscriptionRefCount,
  getAlertSubscriptionSymbols,
  resetSubscriptionRefsForTesting,
  evaluateTickAlerts,
} from "../orchestrator";

describe("Alert Subscriptions & Feed Reconciliation Suite", () => {
  beforeEach(() => {
    resetSubscriptionRefsForTesting();
  });

  it("1. Adds active alert symbols to subscription set on reconciliation", async () => {
    const mockFetcher = async () => ["RELIANCE", "TCS"];
    await reconcileAlertSubscriptions(mockFetcher);

    expect(getSubscriptionRefCount("RELIANCE")).toBe(1);
    expect(getSubscriptionRefCount("TCS")).toBe(1);
    expect(getAlertSubscriptionSymbols().sort()).toEqual(["RELIANCE", "TCS"]);
  });

  it("2. Multiple alerts on same symbol create exactly ONE subscription ref", async () => {
    // Both user A and user B have alerts on INFY
    const mockFetcher = async () => ["INFY", "INFY"];
    await reconcileAlertSubscriptions(mockFetcher);

    expect(getSubscriptionRefCount("INFY")).toBe(1);
    expect(getAlertSubscriptionSymbols()).toEqual(["INFY"]);
  });

  it("3. Removing one of multiple alerts keeps symbol subscribed if still present in active set", async () => {
    // 2 alerts initially on RELIANCE
    await reconcileAlertSubscriptions(async () => ["RELIANCE"]);
    expect(getSubscriptionRefCount("RELIANCE")).toBe(1);

    // One alert removed, but 1 still exists -> symbol remains in active set
    await reconcileAlertSubscriptions(async () => ["RELIANCE"]);
    expect(getSubscriptionRefCount("RELIANCE")).toBe(1);
  });

  it("4. Removing last active alert releases alert-owned reference", async () => {
    await reconcileAlertSubscriptions(async () => ["TCS"]);
    expect(getSubscriptionRefCount("TCS")).toBe(1);

    // Alert deleted or triggered
    await reconcileAlertSubscriptions(async () => []);
    expect(getSubscriptionRefCount("TCS")).toBe(0);
    expect(getAlertSubscriptionSymbols()).toEqual([]);
  });

  it("5. Browser + alert refs coexist correctly without collision", async () => {
    // 1. Browser opens stream for RELIANCE
    const releaseBrowser = subscribeMarketSymbols(["RELIANCE"]);
    expect(getSubscriptionRefCount("RELIANCE")).toBe(1);

    // 2. Alert reconciler adds RELIANCE
    await reconcileAlertSubscriptions(async () => ["RELIANCE"]);
    expect(getSubscriptionRefCount("RELIANCE")).toBe(2);

    // 3. Browser disconnects
    releaseBrowser();
    expect(getSubscriptionRefCount("RELIANCE")).toBe(1); // Alert keeps it alive!

    // 4. Alert deleted
    await reconcileAlertSubscriptions(async () => []);
    expect(getSubscriptionRefCount("RELIANCE")).toBe(0); // Fully cleaned up!
  });

  it("6. Browser disconnect does not remove alert subscription and vice versa", async () => {
    // Alert created first
    await reconcileAlertSubscriptions(async () => ["HDFCBANK"]);
    expect(getSubscriptionRefCount("HDFCBANK")).toBe(1);

    // Browser opens
    const releaseBrowser = subscribeMarketSymbols(["HDFCBANK"]);
    expect(getSubscriptionRefCount("HDFCBANK")).toBe(2);

    // Alert deleted while browser is still open
    await reconcileAlertSubscriptions(async () => []);
    expect(getSubscriptionRefCount("HDFCBANK")).toBe(1); // Browser keeps it alive!

    // Browser closes
    releaseBrowser();
    expect(getSubscriptionRefCount("HDFCBANK")).toBe(0);
  });

  it("7. A failing alert evaluation on a tick is caught instead of rejecting", async () => {
    await reconcileAlertSubscriptions(async () => ["RELIANCE"]);
    const seen: string[] = [];
    const failing = async (quote: { symbol: string }) => {
      seen.push(quote.symbol);
      throw new Error("connection terminated unexpectedly");
    };
    await expect(evaluateTickAlerts(tick("RELIANCE"), failing)).resolves.toBeUndefined();
    expect(seen).toEqual(["RELIANCE"]);
  });

  it("8. A tick for a symbol without an active alert never reaches the alerts query", async () => {
    await reconcileAlertSubscriptions(async () => ["TCS"]);
    const loaded: string[] = [];
    const loadAndEvaluate = async (quote: { symbol: string }) => {
      loaded.push(quote.symbol);
    };
    // Streamed viewers' symbols tick constantly; only alert symbols cost a database read.
    for (const symbol of ["RELIANCE", "INFY", "HDFCBANK", "TCS", "RELIANCE"]) {
      await evaluateTickAlerts(tick(symbol), loadAndEvaluate);
    }
    expect(loaded).toEqual(["TCS"]);

    // Once the last alert on TCS is gone, its ticks stop querying too.
    await reconcileAlertSubscriptions(async () => []);
    await evaluateTickAlerts(tick("TCS"), loadAndEvaluate);
    expect(loaded).toEqual(["TCS"]);
  });
});

function tick(symbol: string): Tick {
  return { exchange: "NSE", symbol, price: 2500, volume: 10, ts: new Date().toISOString(), source: "angelone", quality: "live" };
}
