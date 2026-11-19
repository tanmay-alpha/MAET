/**
 * Strategy definition validation and canonical hashing.
 * - Settings the backtest engine does not implement are rejected by both the Zod schema (API input)
 *   and validateAst (versioning a stored draft), with the path and a reason.
 * - canonicalDefinitionJson covers every field at every depth, independent of key order, so the
 *   version hash distinguishes any two different definitions and equates identical ones.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { canonicalDefinitionJson, canonicalJson, validateAst, type StrategyDefinition } from "./ast";
import { StrategyDefinitionSchema } from "./schemas";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const BASE: StrategyDefinition = {
  name: "sma-cross",
  direction: "LONG_ONLY",
  universe: { type: "SINGLE_SYMBOL", symbolOrId: "RELIANCE" },
  timeframe: "1d",
  entry: {
    kind: "GROUP", id: "e", combinator: "AND",
    children: [{
      kind: "CONDITION", id: "e1",
      left: { kind: "INDICATOR", indicator: "SMA", params: { period: 5 }, lag: 0 },
      operator: "CROSS_ABOVE",
      right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 }, lag: 0 },
    }],
  },
  exit: {
    kind: "GROUP", id: "x", combinator: "OR",
    children: [{ kind: "CONDITION", id: "x1", left: { kind: "INDICATOR", indicator: "RSI", params: { period: 14 }, lag: 1 }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 70 } }],
  },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, stopLossPercent: 5, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5, initialCapital: 100_000 },
};

const clone = (d: StrategyDefinition): StrategyDefinition => structuredClone(d);

/** mulberry32: small deterministic PRNG so the property loops are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same value with object keys re-inserted in a random order at every depth. */
function shuffleKeys(value: unknown, random: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, random));
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, shuffleKeys(record[k], random)]));
}

/** Paths to every number leaf (excluding array indices' own keys). */
function numberLeaves(value: unknown, path: string[] = []): string[][] {
  if (typeof value === "number") return [path];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => numberLeaves(v, [...path, k]));
}

function bumpLeaf(definition: StrategyDefinition, path: string[]): StrategyDefinition {
  const copy = clone(definition) as unknown as Record<string, unknown>;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  const last = path[path.length - 1];
  node[last] = (node[last] as number) + 1;
  return copy as unknown as StrategyDefinition;
}

describe("unsupported settings are rejected at validation", () => {
  const cases: Array<[string, StrategyDefinition]> = [
    ["direction", { ...clone(BASE), direction: "LONG_SHORT" }],
    ["risk.atrStopMultiplier", { ...clone(BASE), risk: { ...BASE.risk, atrStopMultiplier: 2 } }],
    ["risk.allowPyramiding", { ...clone(BASE), risk: { ...BASE.risk, allowPyramiding: true } }],
    ["risk.maximumPyramids", { ...clone(BASE), risk: { ...BASE.risk, maximumPyramids: 2 } }],
  ];

  for (const [path, definition] of cases) {
    it(`rejects ${path} in the API schema and in validateAst`, () => {
      const parsed = StrategyDefinitionSchema.safeParse(definition);
      expect(parsed.success).toBe(false);
      const issue = parsed.success ? undefined : parsed.error.errors.find((e) => e.path.join(".") === path);
      expect(issue?.message).toMatch(/not supported/);

      const ast = validateAst(definition);
      expect(ast.valid).toBe(false);
      expect(ast.errors.find((e) => e.path === path)?.message).toMatch(/not supported/);
    });
  }

  it("accepts the enforced drawdown and daily-loss limits and a plain definition", () => {
    const withLimits = { ...clone(BASE), risk: { ...BASE.risk, maximumDrawdownPercent: 20, maximumDailyLossPercent: 3 } };
    for (const definition of [BASE, withLimits, { ...clone(BASE), direction: "SHORT_ONLY" as const }]) {
      expect(StrategyDefinitionSchema.safeParse(definition).success).toBe(true);
      expect(validateAst(definition).valid).toBe(true);
    }
  });
});

describe("canonicalDefinitionJson", () => {
  const baseJson = canonicalDefinitionJson(BASE);

  it("includes nested rules, risk and execution (not just top-level keys)", () => {
    const parsed = JSON.parse(baseJson) as StrategyDefinition;
    expect(parsed).toEqual(BASE);
  });

  it("differs, with a different hash, when only a nested rule or risk value changes", () => {
    const changedOperator = clone(BASE);
    const firstEntry = changedOperator.entry.children[0];
    if (firstEntry.kind === "CONDITION") firstEntry.operator = "CROSS_BELOW";
    const changedStop = { ...clone(BASE), risk: { ...BASE.risk, stopLossPercent: 6 } };
    const extraCondition = clone(BASE);
    extraCondition.exit.children.push({ kind: "CONDITION", id: "x2", left: { kind: "PRICE", field: "CLOSE" }, operator: "LESS_THAN", right: { kind: "CONSTANT", value: 1 } });
    const hashes = new Set([sha256(baseJson)]);
    for (const variant of [changedOperator, changedStop, extraCondition]) {
      const h = sha256(canonicalDefinitionJson(variant));
      expect(hashes.has(h)).toBe(false);
      hashes.add(h);
    }

    // Every numeric leaf, bumped alone, changes the canonical form.
    for (const path of numberLeaves(BASE)) {
      expect(canonicalDefinitionJson(bumpLeaf(BASE, path))).not.toBe(baseJson);
    }
  });

  it("is identical for the same definition with keys in any order at any depth", () => {
    const random = prng(1234);
    for (let k = 0; k < 200; k++) {
      expect(canonicalDefinitionJson(shuffleKeys(BASE, random) as StrategyDefinition)).toBe(baseJson);
    }
  });

  it("keeps array order (rule order is meaningful) and drops undefined fields", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ b: { d: 1, c: [{ f: 1, e: 2 }] }, a: null })).toBe('{"a":null,"b":{"c":[{"e":2,"f":1}],"d":1}}');
  });
});
