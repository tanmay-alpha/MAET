import { describe, expect, it } from "bun:test";
import type { PaperPositionRow } from "./contracts";
import { PortfolioSnapshotScheduler } from "./portfolio-snapshot-scheduler";
import {
  isTradingDate,
  snapshotSessionFor,
  valueAccount,
  valuePosition,
  type EndOfDayRunResult,
  type SnapshotSession,
} from "./portfolio-snapshots";

const HOLIDAYS = [new Date("2026-11-10T00:00:00.000Z")]; // Tuesday

/** IST wall-clock time as a Date (IST = UTC+05:30). */
function ist(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00.000+05:30`));
}

function position(overrides: Partial<PaperPositionRow> = {}): PaperPositionRow {
  const now = new Date("2026-10-05T04:30:00.000Z");
  return {
    id: "pos-1",
    userId: "user-1",
    symbol: "INFY",
    exchange: "NSE",
    averageEntryPrice: "1000.0000",
    totalShares: 10,
    realizedPnl: "0.0000",
    unrealizedPnl: "0.0000",
    marginLocked: "0.0000",
    createdAt: now,
    updatedAt: now,
    generation: 1,
    lastQuotePrice: "1010.0000",
    lastQuoteSource: "angelone",
    lastQuoteQuality: "live",
    lastQuoteTimestamp: now, // 2026-10-05 10:00 IST
    version: 1,
    side: "LONG",
    ...overrides,
  };
}

describe("snapshot sessions", () => {
  it("treats weekends and configured holidays as non-trading days", () => {
    expect(isTradingDate("2026-11-09", HOLIDAYS)).toBe(true); // Monday
    expect(isTradingDate("2026-11-10", HOLIDAYS)).toBe(false); // holiday
    expect(isTradingDate("2026-11-07", HOLIDAYS)).toBe(false); // Saturday
  });

  it("values today's session once it opens and finalises it 15 minutes after the 15:30 close", () => {
    expect(snapshotSessionFor(ist("2026-11-09", "11:00"), HOLIDAYS)).toEqual({ date: "2026-11-09", isFinal: false });
    expect(snapshotSessionFor(ist("2026-11-09", "15:44"), HOLIDAYS)).toEqual({ date: "2026-11-09", isFinal: false });
    expect(snapshotSessionFor(ist("2026-11-09", "15:45"), HOLIDAYS)).toEqual({ date: "2026-11-09", isFinal: true });
  });

  it("values the latest completed session before the open, on weekends and on holidays", () => {
    // Monday before the open -> previous Friday.
    expect(snapshotSessionFor(ist("2026-11-09", "08:00"), HOLIDAYS)).toEqual({ date: "2026-11-06", isFinal: true });
    expect(snapshotSessionFor(ist("2026-11-08", "12:00"), HOLIDAYS)).toEqual({ date: "2026-11-06", isFinal: true });
    // Holiday Tuesday -> Monday; Wednesday before the open skips the holiday too.
    expect(snapshotSessionFor(ist("2026-11-10", "16:00"), HOLIDAYS)).toEqual({ date: "2026-11-09", isFinal: true });
    expect(snapshotSessionFor(ist("2026-11-11", "09:00"), HOLIDAYS)).toEqual({ date: "2026-11-09", isFinal: true });
  });
});

describe("position valuation", () => {
  const FINAL = { date: "2026-10-05", isFinal: true };
  const INTRADAY = { date: "2026-10-05", isFinal: false };

  it("marks a position at a quote from the session and labels its source", () => {
    const valued = valuePosition(
      position(),
      { price: 1050, ts: ist("2026-10-05", "15:29").toISOString(), source: "yahoo", quality: "delayed" },
      FINAL
    );
    expect(valued).toMatchObject({ price: 1050, source: "yahoo", quality: "delayed", stale: false });
    expect(valued.marketValue).toBe(10_500);
    expect(valued.unrealizedPnl).toBe(500);
  });

  it("uses the more recent last-fill price over an older quote", () => {
    const valued = valuePosition(
      position(),
      { price: 990, ts: ist("2026-10-02", "15:29").toISOString(), source: "yahoo", quality: "delayed" },
      INTRADAY
    );
    expect(valued).toMatchObject({ price: 1010, source: "last_fill:angelone", stale: false });
  });

  it("flags a price from another day as stale instead of presenting it as the close", () => {
    const valued = valuePosition(position(), null, { date: "2026-10-06", isFinal: false });
    expect(valued).toMatchObject({ price: 1010, source: "last_fill:angelone", stale: true });
  });

  it("needs a price from the 15:00-15:30 closing window for a final snapshot", () => {
    // The morning fill price is that session's price, but not its close.
    expect(valuePosition(position(), null, FINAL)).toMatchObject({ price: 1010, stale: true });
    const at = (time: string) => ({ price: 1050, ts: ist("2026-10-05", time).toISOString(), source: "angelone", quality: "delayed" });
    expect(valuePosition(position(), at("14:59"), FINAL).stale).toBe(true);
    expect(valuePosition(position(), at("15:00"), FINAL).stale).toBe(false);
    expect(valuePosition(position(), at("15:29"), FINAL).stale).toBe(false);
    // A pre-open quote is never a close: not the same day's, nor the previous session's.
    expect(valuePosition(position(), at("09:05"), FINAL).stale).toBe(true);
    const nextPreOpen = { price: 1050, ts: ist("2026-10-06", "09:05").toISOString(), source: "angelone", quality: "delayed" };
    expect(valuePosition(position(), nextPreOpen, FINAL).stale).toBe(true);
  });

  it("flags stale and synthetic quotes even when dated on the session", () => {
    const quote = { price: 1050, ts: ist("2026-10-05", "15:29").toISOString(), source: "simulated", quality: "synthetic" };
    expect(valuePosition(position({ lastQuotePrice: null }), quote, FINAL).stale).toBe(true);
  });

  it("falls back to the entry price only as a stale, labelled valuation", () => {
    const valued = valuePosition(position({ lastQuotePrice: null, lastQuoteTimestamp: null }), null, INTRADAY);
    expect(valued).toMatchObject({ price: 1000, source: "entry_price", stale: true, asOf: null, unrealizedPnl: 0 });
  });

  it("values shorts with the sign of the position", () => {
    const valued = valuePosition(
      position({ side: "SHORT" }),
      { price: 1100, ts: ist("2026-10-05", "15:29").toISOString(), source: "angelone", quality: "delayed" },
      FINAL
    );
    expect(valued.side).toBe("SHORT");
    expect(valued.marketValue).toBe(11_000);
    expect(valued.unrealizedPnl).toBe(-1_000);
  });
});

describe("account valuation", () => {
  it("adds unrealised P&L to cash and summarises price sources and staleness", () => {
    const session = { date: "2026-10-05", isFinal: false };
    const fresh = valuePosition(
      position(),
      { price: 1050, ts: ist("2026-10-05", "15:29").toISOString(), source: "angelone", quality: "delayed" },
      session
    );
    const lastFill = valuePosition(position({ id: "pos-2", symbol: "TCS" }), null, session);
    const valuation = valueAccount(
      { cashBalance: "999000.0000", initialCash: "1000000.0000" },
      { realizedPnl: 200, fees: 1200 },
      [fresh, lastFill]
    );
    expect(valuation.equity).toBe(999_000 + 500 + 100);
    expect(valuation.positionsMarketValue).toBe(10_500 + 10_100);
    expect(valuation.stalePrices).toBe(false);
    expect(valuation.priceSource).toBe("angelone,last_fill:angelone");
    expect(valueAccount({ cashBalance: "1", initialCash: "1" }, { realizedPnl: 0, fees: 0 }, []).priceSource).toBe("none");
  });
});

describe("PortfolioSnapshotScheduler", () => {
  function fakeRunner(session: SnapshotSession, results: EndOfDayRunResult[]) {
    const calls: Date[] = [];
    return {
      calls,
      runner: {
        sessionFor: () => session,
        runEndOfDay: async (now: Date) => {
          calls.push(now);
          return results.shift() ?? { status: "ran" as const, date: session.date, written: 0, unchanged: 0, skipped: 0, failed: 0 };
        },
      },
    };
  }

  const ran = (failed: number): EndOfDayRunResult => ({ status: "ran", date: "2026-10-05", written: 1, unchanged: 0, skipped: 0, failed });

  it("does nothing while the session is open", async () => {
    const { runner, calls } = fakeRunner({ date: "2026-10-05", isFinal: false }, []);
    expect(await new PortfolioSnapshotScheduler(runner).tick()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("runs once per closed session, retrying after failures or a held lock", async () => {
    const locked: EndOfDayRunResult = { ...ran(0), status: "locked", written: 0 };
    const { runner, calls } = fakeRunner({ date: "2026-10-05", isFinal: true }, [ran(1), locked, ran(0)]);
    const scheduler = new PortfolioSnapshotScheduler(runner);
    expect((await scheduler.tick())?.failed).toBe(1);
    expect((await scheduler.tick())?.status).toBe("locked");
    expect((await scheduler.tick())?.failed).toBe(0);
    expect(await scheduler.tick()).toBeNull();
    expect(calls).toHaveLength(3);
  });
});
