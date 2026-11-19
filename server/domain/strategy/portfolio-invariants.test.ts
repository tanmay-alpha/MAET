/**
 * Portfolio engine invariants:
 * - exposure caps bind on the post-order portfolio (existing exposure plus the order's fill),
 *   resizing the order down or rejecting it, never letting a cap be breached at entry;
 * - same-bar candidates share one cash pool;
 * - NEXT_BAR_OPEN entries are sized only from what is known at bar i's open;
 * - the reproducibility hash is a content hash of configuration and data.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition, StrategyExecutionConfig, StrategyRiskConfig } from "../../../shared/strategy/ast";
import { runPortfolioBacktestEngine, type PortfolioEngineInput, type PortfolioTradeRecord } from "./portfolio-engine";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

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

/** Constant-price candles from day `startDay`, so exposure is exactly quantity x price. */
function flatCandles(symbol: string, startDay: number, length: number, price = 100): Candle[] {
  return Array.from({ length }, (_, i) => ({
    symbol, tf: "1d", ts: new Date(START + (startDay + i) * DAY).toISOString(),
    open: price, high: price, low: price, close: price, volume: 10_000_000, source: "test",
  }));
}

/** Random-walk candles; the open sits between the previous close and this close. */
function walkCandles(symbol: string, length: number, random: () => number): Candle[] {
  let close = 80 + 40 * random();
  return Array.from({ length }, (_, i) => {
    const prev = close;
    close = Math.max(5, prev * (1 + (random() - 0.5) * 0.06));
    const open = prev + (close - prev) * random();
    return {
      symbol, tf: "1d", ts: new Date(START + i * DAY).toISOString(),
      open, high: Math.max(open, close) * (1 + 0.01 * random()), low: Math.min(open, close) * (1 - 0.01 * random()),
      close, volume: 2_000_000 * (0.5 + random()), source: "test",
    };
  });
}

const ZERO_COST: StrategyExecutionConfig = {
  fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "NONE", slippageBps: 0,
  spreadModel: "NONE", marketImpactModel: "NONE", maxParticipationRate: 1, initialCapital: 100_000,
};

function alwaysEnter(risk: Partial<StrategyRiskConfig> = {}, execution: StrategyExecutionConfig = ZERO_COST): StrategyDefinition {
  return {
    name: "always-enter",
    direction: "LONG_ONLY",
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{ kind: "CONDITION", id: "e1", left: { kind: "PRICE", field: "CLOSE", lag: 0 }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 0 } }],
    },
    exit: { kind: "GROUP", id: "exit", combinator: "OR", children: [] },
    risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 10, allowPyramiding: false, ...risk },
    execution,
  };
}

const quantityOf = (trades: PortfolioTradeRecord[], symbol: string) => trades.find((t) => t.symbol === symbol)?.quantity;

describe("portfolio engine — sector cap binds on the post-order exposure", () => {
  const symbolCandles = { AAA: flatCandles("AAA", 0, 30), BBB: flatCandles("BBB", 5, 25), CCC: flatCandles("CCC", 5, 25) };
  const symbolSectors = { AAA: "IT", BBB: "IT", CCC: "BANK" };

  it("resizes a new IT order to the 40% cap when IT already holds 35%", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "sector", definition: alwaysEnter(), symbolCandles, symbolSectors, initialCapital: 100_000,
      constraints: { maximumPositionPercent: 35, maximumSectorExposurePercent: 40 },
    });
    expect(quantityOf(result.trades, "AAA")).toBe(350); // 35% of 100k at 100
    expect(quantityOf(result.trades, "BBB")).toBe(50); // only the 5% headroom, not another 35%
    expect(quantityOf(result.trades, "CCC")).toBe(350); // another sector is unaffected
    const itExposure = result.trades.filter((t) => t.sector === "IT").reduce((s, t) => s + t.quantity * t.entryPrice, 0);
    expect(itExposure / 100_000).toBeLessThanOrEqual(0.4);
  });

  it("rejects the order when the remaining headroom cannot buy a meaningful position", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "sector-full", definition: alwaysEnter(), symbolCandles, symbolSectors, initialCapital: 100_000,
      constraints: { maximumPositionPercent: 39.95, maximumSectorExposurePercent: 40 },
    });
    expect(quantityOf(result.trades, "AAA")).toBe(399);
    expect(quantityOf(result.trades, "BBB")).toBeUndefined();
    expect(result.excludedSignalsByReason.SECTOR_EXPOSURE_CAP).toBeGreaterThan(0);
  });
});

describe("portfolio engine — gross exposure cap counts the actual fill, not the budget", () => {
  const symbolCandles = { A1: flatCandles("A1", 0, 20), A2: flatCandles("A2", 0, 20), A3: flatCandles("A3", 0, 20), A4: flatCandles("A4", 0, 20) };
  const symbolSectors = { A1: "S1", A2: "S2", A3: "S3", A4: "S4" };
  const run = (sizeValue: number) => runPortfolioBacktestEngine({
    strategyVersionId: "gross", definition: alwaysEnter({ sizingMethod: "FIXED_QUANTITY", sizeValue }), symbolCandles, symbolSectors,
    initialCapital: 100_000, constraints: { maximumPositionPercent: 30, maximumGrossExposurePercent: 40, maximumSectorExposurePercent: 100 },
  });

  it("admits small orders that fit, and resizes the last one to the cap", () => {
    const result = run(120);
    expect(["A1", "A2", "A3", "A4"].map((s) => quantityOf(result.trades, s))).toEqual([120, 120, 120, 40]);
  });

  it("caps an oversized fixed-quantity order at the position cap and the gross cap", () => {
    const result = run(500);
    expect(["A1", "A2", "A3", "A4"].map((s) => quantityOf(result.trades, s))).toEqual([300, 100, undefined, undefined]);
    expect(result.excludedSignalsByReason.GROSS_EXPOSURE_CAP).toBeGreaterThan(0);
  });
});

describe("portfolio engine — caps and cash hold for every entry (property)", () => {
  it("never exceeds the cash, position, sector or gross caps at entry", () => {
    const random = prng(7_2026);
    for (let run = 0; run < 40; run++) {
      const n = 3 + Math.floor(random() * 5);
      const symbols = Array.from({ length: n }, (_, i) => `S${i}`);
      const sectors = ["IT", "BANK", "PHARMA"];
      const symbolSectors = Object.fromEntries(symbols.map((s) => [s, sectors[Math.floor(random() * sectors.length)]]));
      const symbolCandles = Object.fromEntries(symbols.map((s, i) => [s, flatCandles(s, Math.floor(random() * 4), 15, 20 + 10 * i)]));
      const constraints = {
        maximumOpenPositions: 2 + Math.floor(random() * 6),
        maximumPositionPercent: 10 + random() * 60,
        maximumSectorExposurePercent: 15 + random() * 60,
        maximumGrossExposurePercent: 30 + random() * 70,
        cashReservePercent: random() * 20,
      };
      const execution: StrategyExecutionConfig = {
        ...ZERO_COST, feeModel: "FIXED_BPS", feeBps: 10, slippageBps: 5, spreadModel: "FIXED_BPS", baseSpreadBps: 8,
        marketImpactModel: "SQUARE_ROOT", impactCoefficient: 10,
      };
      const sizing: Partial<StrategyRiskConfig> = random() < 0.5
        ? { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100 }
        : { sizingMethod: "FIXED_QUANTITY", sizeValue: 50 + Math.floor(random() * 3_000) };
      const capital = 100_000;
      const result = runPortfolioBacktestEngine({
        strategyVersionId: `prop-${run}`, definition: alwaysEnter(sizing, execution), symbolCandles, symbolSectors,
        initialCapital: capital, constraints,
      });

      // No exits before the last bar: every entry stays open, so the cash spent is cumulative.
      const exitTs = Math.max(...result.trades.map((t) => t.exitTimestamp));
      expect(result.trades.every((t) => t.exitTimestamp === exitTs)).toBe(true);
      expect(result.trades.length).toBeLessThanOrEqual(constraints.maximumOpenPositions);
      // FIXED_BPS charges brokerage only: entry cash = fill notional x 1.001.
      const spent = result.trades.reduce((s, t) => s + t.quantity * t.entryPrice * 1.001, 0);
      expect(spent).toBeLessThanOrEqual(capital + 1e-6);

      // At each entry timestamp, caps hold against the equity before that bar (prices are flat,
      // so the decision equity is at most that mark).
      const entryTimes = [...new Set(result.trades.map((t) => t.entryTimestamp))];
      for (const ts of entryTimes) {
        const prior = result.equityCurve.filter((p) => p.timestamp < ts).at(-1)?.equity ?? capital;
        const open = result.trades.filter((t) => t.entryTimestamp <= ts);
        const exposure = (ts2: PortfolioTradeRecord[]) => ts2.reduce((s, t) => s + t.quantity * t.entryPrice, 0);
        const eps = 1e-6;
        expect(exposure(open)).toBeLessThanOrEqual((prior * constraints.maximumGrossExposurePercent) / 100 + eps);
        for (const sector of sectors) {
          expect(exposure(open.filter((t) => t.sector === sector))).toBeLessThanOrEqual((prior * constraints.maximumSectorExposurePercent) / 100 + eps);
        }
        for (const t of open.filter((x) => x.entryTimestamp === ts)) {
          expect(t.quantity * t.entryPrice).toBeLessThanOrEqual((prior * constraints.maximumPositionPercent) / 100 + eps);
        }
      }
    }
  });
});

describe("portfolio engine — NEXT_BAR_OPEN sizing uses only what is known at the open", () => {
  // AAA is held from day 1; BBB's history starts on day 10, so it enters at the open of day 11.
  const ENTRY_DAY = 11;
  const base = { AAA: flatCandles("AAA", 0, 30), BBB: flatCandles("BBB", 10, 20) };

  function perturbHeldBar(close: number, low: number, high: number): Record<string, Candle[]> {
    return {
      ...base,
      AAA: base.AAA.map((c, i) => (i === ENTRY_DAY ? { ...c, close, low: Math.min(low, c.open, close), high: Math.max(high, c.open, close) } : c)),
    };
  }

  for (const [label, constraints, risk] of [
    ["position-cap bound", { maximumPositionPercent: 30, maximumSectorExposurePercent: 100 }, {}],
    ["cash bound, held position stoppable", { maximumPositionPercent: 60, maximumSectorExposurePercent: 100 }, { stopLossPercent: 5 }],
  ] as const) {
    it(`entry quantity ignores the held symbol's bar-i close, high and low (${label})`, () => {
      const input = (symbolCandles: Record<string, Candle[]>): PortfolioEngineInput => ({
        strategyVersionId: "look-ahead", definition: alwaysEnter(risk), symbolCandles, initialCapital: 100_000, constraints,
      });
      const baseline = runPortfolioBacktestEngine(input(base));
      const baseEntry = baseline.trades.find((t) => t.symbol === "BBB");
      expect(baseEntry?.entryTimestamp).toBe(START + ENTRY_DAY * DAY);

      const random = prng(31337);
      let stopsTriggered = 0;
      for (let k = 0; k < 50; k++) {
        const close = 100 * (0.5 + random());
        const low = close * (1 - 0.2 * random());
        const high = close * (1 + 0.2 * random());
        const perturbed = runPortfolioBacktestEngine(input(perturbHeldBar(close, low, high)));
        const entry = perturbed.trades.find((t) => t.symbol === "BBB");
        expect(entry?.entryTimestamp).toBe(baseEntry!.entryTimestamp);
        expect(entry?.quantity).toBe(baseEntry!.quantity);
        expect(entry?.entryPrice).toBe(baseEntry!.entryPrice);
        if (perturbed.trades.some((t) => t.symbol === "AAA" && t.exitReason === "stop_loss")) stopsTriggered++;
      }
      if ("stopLossPercent" in risk) expect(stopsTriggered).toBeGreaterThan(0);
    });
  }
});

describe("portfolio engine — reproducibility hash is a content hash", () => {
  const random = prng(99);
  const symbolCandles = { AAA: walkCandles("AAA", 60, random), BBB: walkCandles("BBB", 60, random) };
  const input: PortfolioEngineInput = {
    strategyVersionId: "hash", definition: alwaysEnter({ takeProfitPercent: 3 }), symbolCandles, initialCapital: 100_000,
    symbolSectors: { AAA: "IT", BBB: "BANK" },
  };
  const hash = (overrides: Partial<PortfolioEngineInput>) => runPortfolioBacktestEngine({ ...input, ...overrides }).reproducibilityHash;
  const baseline = hash({});

  it("is a SHA-256 hex digest, stable for equal inputs and independent of candle order", () => {
    expect(baseline).toMatch(/^[0-9a-f]{64}$/);
    expect(hash({})).toBe(baseline);
    expect(hash({ symbolCandles: { BBB: [...symbolCandles.BBB].reverse(), AAA: [...symbolCandles.AAA].reverse() } })).toBe(baseline);
  });

  it("changes whenever any candle, config or constraint changes (same lengths)", () => {
    const seen = new Set([baseline]);
    for (let k = 0; k < 25; k++) {
      const i = Math.floor(random() * 60);
      const field = (["open", "high", "low", "close", "volume"] as const)[k % 5];
      const AAA = symbolCandles.AAA.map((c, j) => (j === i ? { ...c, [field]: c[field] * 1.0001 } : c));
      const h = hash({ symbolCandles: { ...symbolCandles, AAA } });
      expect(seen.has(h)).toBe(false);
      seen.add(h);
    }
    for (const overrides of [
      { initialCapital: 100_001 },
      { constraints: { maximumSectorExposurePercent: 39 } },
      { symbolSectors: { AAA: "IT", BBB: "IT" } },
      { rankingMethod: "MOMENTUM" as const },
      { definition: alwaysEnter({ takeProfitPercent: 4 }) },
      { benchmarkCandles: symbolCandles.AAA },
    ]) {
      const h = hash(overrides);
      expect(seen.has(h)).toBe(false);
      seen.add(h);
    }
  });
});
