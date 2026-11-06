import { afterEach, describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import { databaseBreakerState, recordDatabaseFailure, resetDatabaseBreakerForTests } from "../../data/drizzle/availability";
import { loadMarketCandles, type CandleStore } from "./candle-service";

afterEach(() => {
  resetDatabaseBreakerForTests();
});

const FROM = new Date("2026-10-01T00:00:00.000Z");
const TO = new Date("2026-11-01T00:00:00.000Z");

const yahooCandles: Candle[] = [
  { symbol: "RELIANCE", tf: "1d", ts: "2026-10-30T03:45:00.000Z", open: 1, high: 2, low: 1, close: 2, volume: 10 },
  { symbol: "RELIANCE", tf: "1d", ts: "2026-10-31T03:45:00.000Z", open: 2, high: 3, low: 2, close: 3, volume: 10 },
];

/** A database that never answers, like an unreachable host before connect_timeout. */
function hangingStore() {
  const calls = { read: 0, write: 0 };
  const store: CandleStore = {
    read: () => {
      calls.read++;
      return new Promise<Candle[]>(() => {});
    },
    write: () => {
      calls.write++;
      return new Promise<void>(() => {});
    },
  };
  return { store, calls };
}

describe("loadMarketCandles with the database circuit open", () => {
  it("skips the database entirely and serves Yahoo history", async () => {
    recordDatabaseFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const { store, calls } = hangingStore();

    const result = await loadMarketCandles("RELIANCE", "1d", FROM, TO, {
      store,
      fetchCandles: async () => yahooCandles,
    });

    expect(result).toMatchObject({ source: "yahoo", persisted: false });
    expect(result.candles).toHaveLength(2);
    expect(calls).toEqual({ read: 0, write: 0 });
  });

  it("opens the circuit when a read fails with a connection error", async () => {
    const store: CandleStore = {
      read: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND db.example.supabase.co"), { code: "ENOTFOUND" });
      },
      write: async () => {},
    };

    const result = await loadMarketCandles("RELIANCE", "1d", FROM, TO, { store, fetchCandles: async () => yahooCandles });

    expect(result.source).toBe("yahoo");
    expect(databaseBreakerState()).toBe("open");
  });
});
