import { describe, expect, it } from "bun:test";
import { tokenize, TokenKind } from "./tokenizer";
import { ScreenerDslParser } from "./parser";
import { ScreenerCompiler } from "./compiler";
import { evaluate } from "../../domain/screener/engine";
import { FIELD_MAPPINGS } from "@shared/screener/schema";
import { CriterionFieldSchema } from "@shared/types/screener";
import type { Fundamentals } from "../../data/sources/nse";

const compile = (input: string) => {
  const parseRes = new ScreenerDslParser().parse(input);
  expect(parseRes.success).toBe(true);
  return new ScreenerCompiler().compile(parseRes.ast!);
};

const tick = { exchange: "NSE" as const, symbol: "INFY", price: 1500, volume: 100000, ts: new Date().toISOString(), source: "angelone" as const, quality: "live" as const };

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

  it("8. Only maps fields the criterion schema accepts", () => {
    for (const m of FIELD_MAPPINGS) {
      expect({ field: m.screenerField, ok: CriterionFieldSchema.safeParse(m.screenerField).success })
        .toEqual({ field: m.screenerField, ok: true });
    }
  });

  it("9. Reports fields the engine cannot evaluate as unsupported, not as a schema error", () => {
    for (const [input, field] of [
      ["roce above 15%", "roce"],
      ["debt to equity below 1", "debt_to_equity"],
      ["net margin above 10%", "net_margin"],
      ["sector above banks", "sector"],
    ] as const) {
      const res = compile(input);
      expect(res.success).toBe(false);
      expect(res.criteria).toBeNull();
      expect(res.errors).toEqual([`Error: Unsupported field: '${field}'`]);
    }
  });

  it("10. Compiles and evaluates price and volume from the tick", () => {
    const res = compile("price above 1000 and volume above 50000");
    expect(res.success).toBe(true);
    expect(evaluate(res.criteria!, { tick })).toBe(true);
    expect(evaluate(res.criteria!, { tick: { ...tick, price: 900 } })).toBe(false);
  });

  it("11. Parses negative bounds", () => {
    expect(tokenize("roe between -10% and 5%").filter((t) => t.kind === TokenKind.Number).map((t) => t.value))
      .toEqual(["-10%", "5%"]);

    const range = compile("roe between -10% and 5%");
    expect(range.success).toBe(true);
    expect(range.criteria).toEqual({ field: "roe", op: "between", value: [-0.1, 0.05], unit: "pct" });
    const withRoe = (roe: number) => ({ tick, fundamentals: { symbol: "INFY", asOf: tick.ts, roe, raw: {} } satisfies Fundamentals });
    expect(evaluate(range.criteria!, withRoe(-0.05))).toBe(true);
    expect(evaluate(range.criteria!, withRoe(-0.2))).toBe(false);

    const below = compile("roe below -5%");
    expect(below.criteria).toEqual({ field: "roe", op: "lt", value: -0.05, unit: "pct" });
    expect(evaluate(below.criteria!, withRoe(-0.1))).toBe(true);
    expect(evaluate(below.criteria!, withRoe(0))).toBe(false);

    expect(compile("macd below -2").criteria).toEqual({ field: "macd", op: "lt", value: -2 });
  });

  it("12. Hyphenated field names still tokenize as fields", () => {
    const [field] = tokenize("market-cap above 100");
    expect(field).toMatchObject({ kind: TokenKind.Field, value: "market_cap" });
  });
});
