import { describe, it, expect } from "bun:test";
import { evaluate } from "./engine";
import type { Tick } from "@shared/types";
import type { Fundamentals } from "../../data/sources/nse";

const tick: Tick = {
  exchange: "NSE",
  symbol: "RELIANCE",
  price: 100,
  volume: 1,
  ts: new Date().toISOString(),
  source: "yahoo",
};
const fund: Fundamentals = {
  symbol: "RELIANCE",
  asOf: new Date().toISOString(),
  pe: 20,
  pb: 3,
  roe: 15,
  sector: "IT",
  raw: {},
};

describe("evaluate", () => {
  it("pe lt 30 is true", () => {
    expect(evaluate({ field: "pe", op: "lt", value: 30 }, { tick, fundamentals: fund })).toBe(true);
  });

  it("pe gte 30 is false", () => {
    expect(evaluate({ field: "pe", op: "gte", value: 30 }, { tick, fundamentals: fund })).toBe(false);
  });

  it("sector eq IT is true", () => {
    expect(evaluate({ field: "sector", op: "eq", value: "IT" }, { tick, fundamentals: fund })).toBe(true);
  });

  it("between is inclusive", () => {
    expect(evaluate({ field: "pe", op: "between", value: [10, 20] }, { tick, fundamentals: fund })).toBe(true);
    expect(evaluate({ field: "pe", op: "between", value: [21, 30] }, { tick, fundamentals: fund })).toBe(false);
  });

  it("AND group requires all true", () => {
    expect(
      evaluate(
        { op: "AND", children: [{ field: "pe", op: "lt", value: 30 }, { field: "pb", op: "lt", value: 5 }] },
        { tick, fundamentals: fund },
      ),
    ).toBe(true);
    expect(
      evaluate(
        { op: "AND", children: [{ field: "pe", op: "lt", value: 30 }, { field: "pb", op: "lt", value: 1 }] },
        { tick, fundamentals: fund },
      ),
    ).toBe(false);
  });

  it("OR group requires at least one true", () => {
    expect(
      evaluate(
        { op: "OR", children: [{ field: "pe", op: "lt", value: 1 }, { field: "pb", op: "lt", value: 5 }] },
        { tick, fundamentals: fund },
      ),
    ).toBe(true);
  });

  it("price and volume come from the tick", () => {
    expect(evaluate({ field: "price", op: "gt", value: 99 }, { tick })).toBe(true);
    expect(evaluate({ field: "price", op: "gt", value: 100 }, { tick })).toBe(false);
    expect(evaluate({ field: "volume", op: "between", value: [1, 5] }, { tick })).toBe(true);
  });

  it("macd is the latest MACD line of the candle closes", () => {
    const rising = Array.from({ length: 40 }, (_, i) => ({ close: 100 + i }));
    const falling = Array.from({ length: 40 }, (_, i) => ({ close: 200 - i }));
    expect(evaluate({ field: "macd", op: "gt", value: 0 }, { tick, candles1m: rising })).toBe(true);
    expect(evaluate({ field: "macd", op: "lt", value: 0 }, { tick, candles1m: falling })).toBe(true);
    // Too few closes for the slow EMA: no value, so no match.
    expect(evaluate({ field: "macd", op: "gt", value: -1e9 }, { tick, candles1m: rising.slice(0, 10) })).toBe(false);
  });
});