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
});