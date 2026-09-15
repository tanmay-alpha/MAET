import { describe, it, expect } from "bun:test";
import { ExecutionModel } from "./execution-model";
import type { Candle } from "@shared/types";
import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";

function makeCandle(open: number, high: number, low: number, close: number, volume = 100_000, ts = "2024-01-01T09:15:00.000Z"): Candle {
  return { symbol: "TCS", tf: "1d", ts, open, high, low, close, volume, source: "test" };
}

describe("P2 Realistic Execution Model — Spread & Market Impact (Commit 1)", () => {
  const baseConfig: StrategyExecutionConfig = {
    fillPolicy: "NEXT_BAR_OPEN",
    intrabarPolicy: "CONSERVATIVE",
    feeModel: "NONE",
    feeBps: 0,
    slippageBps: 0,
    initialCapital: 100_000,
    spreadModel: "FIXED_BPS",
    baseSpreadBps: 10, // 10 bps total spread -> 5 bps half spread
    marketImpactModel: "SQUARE_ROOT",
    impactCoefficient: 10,
    maxParticipationRate: 0.1, // 10%
  };

  it("1. Spread asymmetry: BUY pays worse (higher) than reference; SELL receives worse (lower)", () => {
    const model = new ExecutionModel(baseConfig);
    const candle = makeCandle(1000, 1010, 990, 1005, 1_000_000);

    // BUY order
    const buyRes = model.executeBarFill({
      bar: candle,
      orderQuantity: 10,
      side: "BUY",
      config: baseConfig,
    }, 10);

    // SELL order
    const sellRes = model.executeBarFill({
      bar: candle,
      orderQuantity: 10,
      side: "SELL",
      config: baseConfig,
    }, 10);

    expect(buyRes.effectivePrice).toBeGreaterThan(1000);
    expect(sellRes.effectivePrice).toBeLessThan(1000);

    // Reference price is 1000
    expect(buyRes.referencePrice).toBe(1000);
    expect(sellRes.referencePrice).toBe(1000);

    // Spread bps is 10
    expect(buyRes.spreadBps).toBe(10);
    expect(sellRes.spreadBps).toBe(10);
  });

  it("2. Market impact model: larger orders incur worse execution", () => {
    const model = new ExecutionModel(baseConfig);
    const candle = makeCandle(1000, 1010, 990, 1005, 100_000); // 100,000 bar volume

    // Small order: 100 shares -> 0.1% participation
    const smallRes = model.executeBarFill({
      bar: candle,
      orderQuantity: 100,
      side: "BUY",
      config: baseConfig,
    }, 100);

    // Large order: 5,000 shares -> 5% participation
    const largeRes = model.executeBarFill({
      bar: candle,
      orderQuantity: 5000,
      side: "BUY",
      config: baseConfig,
    }, 5000);

    expect(largeRes.impactBps).toBeGreaterThan(smallRes.impactBps);
    expect(largeRes.effectivePrice).toBeGreaterThan(smallRes.effectivePrice);
    expect(smallRes.impactBps).toBeGreaterThan(0);
    expect(Number.isFinite(largeRes.impactBps)).toBe(true);
  });

  it("3. Market impact invariants: non-negative, finite, 0 impact on 0 quantity", () => {
    const model = new ExecutionModel(baseConfig);
    const candle = makeCandle(1000, 1010, 990, 1005, 100_000);

    const zeroRes = model.executeBarFill({
      bar: candle,
      orderQuantity: 0,
      side: "BUY",
      config: baseConfig,
    }, 0);

    expect(zeroRes.fillQuantity).toBe(0);
    expect(zeroRes.impactBps).toBe(0);
    expect(zeroRes.effectivePrice).toBe(1000);

    // Low liquidity bar: 1 share volume
    const illiquidCandle = makeCandle(1000, 1010, 990, 1005, 1);
    const cappedRes = model.executeBarFill({
      bar: illiquidCandle,
      orderQuantity: 1000,
      side: "BUY",
      config: { ...baseConfig, maxImpactBps: 150 },
    }, 1000);

    expect(cappedRes.impactBps).toBeLessThanOrEqual(150);
    expect(cappedRes.impactBps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(cappedRes.effectivePrice)).toBe(true);
  });

  it("4. Spread models: NONE, FIXED_BPS, VOLATILITY_BASED, LIQUIDITY_BASED", () => {
    const model = new ExecutionModel(baseConfig);
    const candle = makeCandle(1000, 1050, 950, 1000, 50_000); // 10% range

    const spreadNone = model.calculateSpreadBps({
      bar: candle, orderQuantity: 100, side: "BUY", config: { ...baseConfig, spreadModel: "NONE" },
    }, 1000);
    expect(spreadNone).toBe(0);

    const spreadFixed = model.calculateSpreadBps({
      bar: candle, orderQuantity: 100, side: "BUY", config: { ...baseConfig, spreadModel: "FIXED_BPS", baseSpreadBps: 12 },
    }, 1000);
    expect(spreadFixed).toBe(12);

    const spreadVol = model.calculateSpreadBps({
      bar: candle, orderQuantity: 100, side: "BUY", rollingAtr: 40, config: { ...baseConfig, spreadModel: "VOLATILITY_BASED", baseSpreadBps: 5 },
    }, 1000);
    expect(spreadVol).toBeGreaterThan(5);

    const spreadLiq = model.calculateSpreadBps({
      bar: candle, orderQuantity: 100, side: "BUY", averageDailyVolume: 500_000, config: { ...baseConfig, spreadModel: "LIQUIDITY_BASED", baseSpreadBps: 5 },
    }, 1000);
    expect(spreadLiq).toBeGreaterThan(5);
  });

  it("5. Execution cost breakdown reporting", () => {
    const model = new ExecutionModel({
      ...baseConfig,
      feeModel: "FIXED_BPS",
      feeBps: 10,
      slippageBps: 5,
    });
    const candle = makeCandle(100, 101, 99, 100, 50_000);

    const fillRes = model.executeBarFill({
      bar: candle,
      orderQuantity: 100,
      side: "BUY",
      config: {
        ...baseConfig,
        feeModel: "FIXED_BPS",
        feeBps: 10,
        slippageBps: 5,
      },
    }, 100);

    expect(fillRes.costs.spreadCost).toBeGreaterThan(0);
    expect(fillRes.costs.slippageCost).toBeGreaterThan(0);
    expect(fillRes.costs.totalTransactionCost).toBeGreaterThan(0);
    expect(fillRes.costs.costDragPercent).toBeGreaterThan(0);
  });
});
