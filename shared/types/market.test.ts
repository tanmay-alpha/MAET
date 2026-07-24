import { describe, expect, it } from "bun:test";
import {
  parseExecutionQuote,
  type ExecutionQuote,
} from "./market";

const validQuote: ExecutionQuote = {
  exchange: "NSE",
  symbol: "RELIANCE",
  price: 2500,
  volume: 1000,
  ts: "2026-07-25T00:00:00.000Z",
  source: "angelone",
  quality: "live",
};

describe("parseExecutionQuote", () => {
  const invalidCases: Array<{
    name: string;
    raw: unknown;
    field: string;
  }> = [
    {
      name: "missing exchange",
      raw: {
        symbol: validQuote.symbol,
        price: validQuote.price,
        ts: validQuote.ts,
        source: validQuote.source,
        quality: validQuote.quality,
      },
      field: "exchange",
    },
    {
      name: "missing symbol",
      raw: {
        exchange: validQuote.exchange,
        price: validQuote.price,
        ts: validQuote.ts,
        source: validQuote.source,
        quality: validQuote.quality,
      },
      field: "symbol",
    },
    {
      name: "missing source",
      raw: {
        exchange: validQuote.exchange,
        symbol: validQuote.symbol,
        price: validQuote.price,
        ts: validQuote.ts,
        quality: validQuote.quality,
      },
      field: "source",
    },
    {
      name: "missing quality",
      raw: {
        exchange: validQuote.exchange,
        symbol: validQuote.symbol,
        price: validQuote.price,
        ts: validQuote.ts,
        source: validQuote.source,
      },
      field: "quality",
    },
    {
      name: "missing timestamp",
      raw: {
        exchange: validQuote.exchange,
        symbol: validQuote.symbol,
        price: validQuote.price,
        source: validQuote.source,
        quality: validQuote.quality,
      },
      field: "timestamp",
    },
  ];

  for (const testCase of invalidCases) {
    it(`rejects ${testCase.name}`, () => {
      const result = parseExecutionQuote(testCase.raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain(
          testCase.field
        );
      }
    });
  }

  it("rejects a symbol mismatch", () => {
    const result = parseExecutionQuote(
      validQuote,
      "TCS"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(
        "Quote symbol mismatch"
      );
    }
  });

  it("does not use a legacy timestamp fallback", () => {
    const result = parseExecutionQuote({
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      timestamp: validQuote.ts,
      source: "angelone",
      quality: "live",
    });
    expect(result.ok).toBe(false);
  });

  it("does not fill exchange, source, or quality defaults", () => {
    const result = parseExecutionQuote({
      symbol: "RELIANCE",
      price: 2500,
      ts: validQuote.ts,
    });
    expect(result.ok).toBe(false);
  });

  it("returns schema data without mutating the input", () => {
    const raw = {
      ...validQuote,
      previousClose: 2450,
    };
    const before = structuredClone(raw);
    const result = parseExecutionQuote(raw, "RELIANCE");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote).toEqual(validQuote);
      expect("previousClose" in result.quote).toBe(false);
    }
    expect(raw).toEqual(before);
  });
});
