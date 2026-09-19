import { describe, expect, it } from "bun:test";
import { tokenize } from "./tokenizer";
import { ScreenerDslParser } from "./parser";
import { ScreenerCompiler } from "./compiler";
import { evaluate } from "../../domain/screener/engine";

describe("Screener DSL Integration Test Suite", () => {
  it("1. Compiles natural language text to canonical criteria object without raw SQL", () => {
    const input = "pe below 25 and roe above 15";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);

    expect(parseRes.success).toBe(true);
    expect(parseRes.ast).not.toBeNull();

    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    expect(res.success).toBe(true);
    expect(res.criteria).toBeDefined();
    expect(res.preview?.filters.length).toBeGreaterThan(0);
  });

  it("2. Handles 'between' with BooleanOp 'and' token without error", () => {
    const input = "pe between 10 and 30";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);

    expect(parseRes.success).toBe(true);
    expect(parseRes.ast).not.toBeNull();

    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    expect(res.success).toBe(true);
    expect(res.criteria).toEqual({
      field: "pe",
      op: "between",
      value: [10, 30],
    });
  });

  it("3. Converts percentage ratio bounds into decimal fractions for 'between'", () => {
    const input = "roe between 15% and 40%";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);

    expect(parseRes.success).toBe(true);

    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    expect(res.success).toBe(true);
    expect(res.criteria).toEqual({
      field: "roe",
      op: "between",
      value: [0.15, 0.40],
      unit: "pct",
    });
  });

  it("4. Normalizes & and | boolean operators to and/or expressions", () => {
    const input = "pe below 20 & roe above 15";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);

    expect(parseRes.success).toBe(true);

    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    expect(res.success).toBe(true);
    expect(res.criteria).toMatchObject({
      op: "AND",
      children: [
        { field: "pe", op: "lt", value: 20 },
        { field: "roe", op: "gt", value: 0.15, unit: "pct" },
      ],
    });
  });

  it("5. Correctly tokenizes and compiles 'crosses above' and 'crosses below'", () => {
    const input = "rsi crosses above 30";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);

    expect(parseRes.success).toBe(true);

    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    expect(res.success).toBe(true);
    expect(res.criteria).toEqual({
      field: "rsi",
      op: "gt",
      value: 30,
    });
  });

  it("6. Cap keywords build market-cap classification predicates instead of sector filters", () => {
    const input = "large cap pe below 25";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);

    expect(parseRes.success).toBe(true);

    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    expect(res.success).toBe(true);
    expect(res.criteria).toMatchObject({
      op: "AND",
      children: [
        { field: "market_cap", op: "gt", value: 50000 },
        { field: "pe", op: "lt", value: 25 },
      ],
    });
  });

  it("7. Evaluates compiled criteria correctly in execution engine", () => {
    const input = "pe below 25 and roe above 15";
    const parser = new ScreenerDslParser();
    const parseRes = parser.parse(input);
    const compiler = new ScreenerCompiler();
    const res = compiler.compile(parseRes.ast!);

    const passingCtx = {
      tick: { exchange: "NSE" as const, symbol: "INFY", price: 1500, volume: 100000, ts: new Date().toISOString(), source: "angelone" as const, quality: "live" as const },
      fundamentals: { pe: 20, roe: 0.25, pb: 4, marketCap: 600000, dividendYield: 0.02 },
    };

    const failingCtx = {
      tick: { exchange: "NSE" as const, symbol: "TEST", price: 500, volume: 10000, ts: new Date().toISOString(), source: "angelone" as const, quality: "live" as const },
      fundamentals: { pe: 30, roe: 0.10, pb: 4, marketCap: 50000, dividendYield: 0.01 },
    };

    expect(evaluate(res.criteria!, passingCtx)).toBe(true);
    expect(evaluate(res.criteria!, failingCtx)).toBe(false);
  });
});
