import type { Criterion } from "@shared/types";
import type { Tick } from "@shared/types";
import type { Fundamentals } from "../../data/sources/nse";

export type EvalCtx = {
  tick: Tick;
  fundamentals?: Fundamentals;
  candles1m?: { close: number }[]; // for sma/rsi
};

function getNumeric(ctx: EvalCtx, c: { field: string; period?: number }): number | undefined {
  switch (c.field) {
    case "pe":
      return ctx.fundamentals?.pe;
    case "pb":
      return ctx.fundamentals?.pb;
    case "roe":
      return ctx.fundamentals?.roe;
    case "market_cap":
      return ctx.fundamentals?.marketCap;
    case "dividend_yield":
      return ctx.fundamentals?.dividendYield;
    case "rsi": {
      const period = c.period ?? 14;
      const closes = (ctx.candles1m ?? []).map((x) => x.close);
      return rsi(closes, period);
    }
    default:
      return undefined;
  }
}

function getString(ctx: EvalCtx, c: { field: string }): string | undefined {
  if (c.field === "sector") return ctx.fundamentals?.sector;
  return undefined;
}

function rsi(closes: number[], period: number): number | undefined {
  if (closes.length < period + 1) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += -diff;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function cmp(a: number, op: "eq" | "gt" | "lt" | "gte" | "lte", b: number): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "gte":
      return a >= b;
    case "lte":
      return a <= b;
  }
}

export function evaluate(c: Criterion, ctx: EvalCtx): boolean {
  if ("op" in c && (c.op === "AND" || c.op === "OR")) {
    if (c.op === "AND") return c.children.every((x) => evaluate(x, ctx));
    return c.children.some((x) => evaluate(x, ctx));
  }
  const leaf = c as {
    field: string;
    op: "eq" | "gt" | "lt" | "gte" | "lte" | "between";
    value: number | string | [number, number];
    period?: number;
  };
  if (leaf.op === "between") {
    const v = getNumeric(ctx, leaf);
    if (v === undefined) return false;
    const [lo, hi] = leaf.value as [number, number];
    return v >= lo && v <= hi;
  }
  const isNumericField = leaf.field !== "sector";
  if (isNumericField) {
    const v = getNumeric(ctx, leaf);
    if (v === undefined) return false;
    if (typeof leaf.value !== "number") return false;
    return cmp(v, leaf.op, leaf.value);
  }
  const s = getString(ctx, leaf);
  if (s === undefined) return false;
  if (leaf.op !== "eq") return false;
  return s === leaf.value;
}