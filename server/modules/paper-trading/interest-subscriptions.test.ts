import { afterEach, describe, expect, it } from "bun:test";
import { recordDatabaseFailure, resetDatabaseBreakerForTests } from "../../data/drizzle/availability";
import { PaperInterestSubscriptions, type PaperInterestRow } from "./interest-subscriptions";

const silent = { info() {}, warn() {}, debug() {} };

function harness(
  initial: PaperInterestRow[],
  options: { maxSymbols?: number; hasFeedToken?: (symbol: string) => boolean } = {}
) {
  let rows = initial;
  let fetches = 0;
  const refs = new Map<string, number>();
  const warnings: string[] = [];
  const interest = new PaperInterestSubscriptions({
    fetchInterest: async () => {
      fetches++;
      return rows;
    },
    subscribe: (symbol) => refs.set(symbol, (refs.get(symbol) ?? 0) + 1),
    unsubscribe: (symbol) => {
      const count = (refs.get(symbol) ?? 0) - 1;
      if (count <= 0) refs.delete(symbol);
      else refs.set(symbol, count);
    },
    maxSymbols: options.maxSymbols,
    hasFeedToken: options.hasFeedToken ?? (() => true),
    log: { ...silent, warn: (_fields: unknown, message: string) => warnings.push(message) },
  });
  return {
    interest,
    refs,
    warnings,
    fetches: () => fetches,
    setRows: (next: PaperInterestRow[]) => {
      rows = next;
    },
  };
}

const order = (symbol: string, exchange = "NSE", userId = "user-1"): PaperInterestRow => ({
  userId,
  exchange,
  symbol,
  kind: "ORDER",
});
const position = (symbol: string, exchange = "NSE", userId = "user-1"): PaperInterestRow => ({
  userId,
  exchange,
  symbol,
  kind: "POSITION",
});

afterEach(() => {
  resetDatabaseBreakerForTests();
});

describe("PaperInterestSubscriptions", () => {
  it("subscribes the symbols of working orders and open positions once each", async () => {
    const { interest, refs } = harness([order("RELIANCE"), position("RELIANCE"), position("TCS")]);
    await interest.reconcile();

    expect(Object.fromEntries(refs)).toEqual({ RELIANCE: 1, TCS: 1 });
    expect(interest.symbols().sort()).toEqual(["RELIANCE", "TCS"]);
  });

  it("releases symbols that no longer have working orders or positions", async () => {
    const { interest, refs, setRows } = harness([order("INFY"), position("TCS")]);
    await interest.reconcile();
    setRows([position("TCS")]);
    await interest.reconcile();

    expect(Object.fromEntries(refs)).toEqual({ TCS: 1 });
  });

  it("skips BSE symbols because the live feed only streams NSE, and says so", async () => {
    const { interest, refs, warnings } = harness([order("RELIANCE", "BSE"), position("TCS")]);
    await interest.reconcile();

    expect(Object.fromEntries(refs)).toEqual({ TCS: 1 });
    expect(warnings.some((message) => /BSE/.test(message))).toBe(true);
  });

  it("keeps working orders ahead of positions when the set exceeds the symbol cap", async () => {
    const { interest, refs, warnings } = harness(
      [position("P1"), order("O1"), position("P2"), order("O2"), position("P3")],
      { maxSymbols: 3 }
    );
    await interest.reconcile();

    expect([...refs.keys()].sort()).toEqual(["O1", "O2", "P1"]);
    expect(warnings.some((message) => /cap/.test(message))).toBe(true);
  });

  it("drops symbols the feed cannot stream before applying the symbol cap", async () => {
    const { interest, refs, warnings } = harness(
      [order("FAKE1"), order("FAKE2"), order("REAL1"), position("REAL2")],
      { maxSymbols: 2, hasFeedToken: (symbol) => !symbol.startsWith("FAKE") }
    );
    await interest.reconcile();

    expect([...refs.keys()].sort()).toEqual(["REAL1", "REAL2"]);
    expect(warnings.some((message) => /token/.test(message))).toBe(true);
    expect(warnings.some((message) => /cap/.test(message))).toBe(false);
  });

  it("shares the symbol cap across users so one user cannot take every slot", async () => {
    const hog = ["H1", "H2", "H3", "H4", "H5"].map((symbol) => order(symbol, "NSE", "hog"));
    const { interest, refs } = harness(
      [...hog, position("B1", "NSE", "user-b"), order("C1", "NSE", "user-c")],
      { maxSymbols: 4 }
    );
    await interest.reconcile();

    expect(refs.has("B1")).toBe(true);
    expect(refs.has("C1")).toBe(true);
    expect(refs.size).toBe(4);
  });

  it("drops symbols without an Angel One instrument token by default", async () => {
    const refs = new Map<string, number>();
    const interest = new PaperInterestSubscriptions({
      fetchInterest: async () => [order("NOTALISTEDSYMBOL"), order("RELIANCE")],
      subscribe: (symbol) => refs.set(symbol, 1),
      unsubscribe: (symbol) => refs.delete(symbol),
      log: silent,
    });
    await interest.reconcile();

    expect([...refs.keys()]).toEqual(["RELIANCE"]);
  });

  it("does not query the database while the circuit breaker is open and keeps the current set", async () => {
    const { interest, refs, fetches } = harness([order("HDFCBANK")]);
    await interest.reconcile();
    expect(fetches()).toBe(1);

    recordDatabaseFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    await interest.reconcile();

    expect(fetches()).toBe(1);
    expect(Object.fromEntries(refs)).toEqual({ HDFCBANK: 1 });
  });

  it("keeps the current set when the query fails", async () => {
    const refs = new Map<string, number>();
    let fail = false;
    const interest = new PaperInterestSubscriptions({
      fetchInterest: async () => {
        if (fail) throw new Error("syntax error");
        return [order("ITC")];
      },
      subscribe: (symbol) => refs.set(symbol, 1),
      unsubscribe: (symbol) => refs.delete(symbol),
      log: silent,
    });
    await interest.reconcile();
    fail = true;
    await interest.reconcile();

    expect([...refs.keys()]).toEqual(["ITC"]);
  });

  it("coalesces refresh requests into one follow-up query while a reconcile is running", async () => {
    const gate = Promise.withResolvers<void>();
    let fetches = 0;
    const interest = new PaperInterestSubscriptions({
      fetchInterest: async () => {
        fetches++;
        if (fetches === 1) await gate.promise;
        return [order("SBIN")];
      },
      subscribe: () => {},
      unsubscribe: () => {},
      log: silent,
    });

    const first = interest.reconcile();
    interest.requestRefresh();
    interest.requestRefresh();
    interest.requestRefresh();
    gate.resolve();
    await first;
    await interest.idle();

    expect(fetches).toBe(2);
  });

  it("releases every owned symbol on stop and ignores a reconcile that finishes afterwards", async () => {
    const gate = Promise.withResolvers<void>();
    let rows = [order("WIPRO")];
    let hold = false;
    const refs = new Map<string, number>();
    const interest = new PaperInterestSubscriptions({
      fetchInterest: async () => {
        if (hold) await gate.promise;
        return rows;
      },
      subscribe: (symbol) => refs.set(symbol, 1),
      unsubscribe: (symbol) => refs.delete(symbol),
      log: silent,
      intervalMs: 3_600_000,
    });
    interest.start();
    await interest.idle();
    expect([...refs.keys()]).toEqual(["WIPRO"]);

    hold = true;
    rows = [order("WIPRO"), order("ONGC")];
    interest.requestRefresh();
    interest.stop();
    gate.resolve();
    await interest.idle();

    expect(refs.size).toBe(0);
  });
});
