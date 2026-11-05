import { describe, it, expect } from "bun:test";
import { calculateSlippage, getLiquidityTier } from "./slippage";

// Order matching itself is exercised against PostgreSQL in
// server/modules/paper-trading/engine-integrity.integration.test.ts and
// server/modules/paper-trading/concurrency.integration.test.ts.

describe("Slippage Engine (Almgren-Chriss)", () => {
  it("classifies liquidity tiers correctly based on volume and cap", () => {
    expect(getLiquidityTier(2500000)).toBe("HIGH");
    expect(getLiquidityTier(500000)).toBe("MEDIUM");
    expect(getLiquidityTier(50000)).toBe("LOW");
    expect(getLiquidityTier(undefined, "large")).toBe("HIGH");
    expect(getLiquidityTier(undefined, "mid")).toBe("MEDIUM");
    expect(getLiquidityTier(undefined, "small")).toBe("LOW");
    expect(getLiquidityTier(undefined, undefined)).toBe("MEDIUM");
  });

  it("calculates slippage with Almgren-Chriss formulation", () => {
    const ltp = 1000;
    const orderQty = 1000;
    const slippage = calculateSlippage(ltp, orderQty, 3000000, "large", 0.02);
    expect(slippage).toBeCloseTo(0.730738, 4);
  });
});
