import { describe, expect, it } from "bun:test";
import { tokenize } from "./tokenizer";
import { ScreenerDslParser } from "./parser";
import { ScreenerCompiler } from "./compiler";

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
});
