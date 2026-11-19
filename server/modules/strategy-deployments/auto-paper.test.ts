/**
 * AUTO_PAPER deployment evaluator — pure risk gate, sizing, direction and warm-up rules.
 */

import { describe, expect, it } from "bun:test";
import {
  entrySide,
  evaluateRiskGate,
  gateUnrealisedPnl,
  markPaperEquity,
  requiredHistoryBars,
  resizeEntryForQuote,
  sizeAutoPaperEntry,
} from "../../workers/strategy-evaluator";
import type { StrategyDefinition, StrategyRuleGroup } from "../../../shared/strategy/ast";

const active = (riskLimits: Record<string, number> = {}) => ({
  status: "ACTIVE",
  riskLimits,
  userKillSwitch: false,
  deploymentKillSwitch: false,
});
const ENTRY = { type: "ENTRY" as const, symbol: "TCS" };
const EXIT = { type: "EXIT" as const, symbol: "TCS" };

function group(...children: StrategyRuleGroup["children"]): StrategyRuleGroup {
  return { kind: "GROUP", id: "g", combinator: "AND", children };
}
function definition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
  return { name: "t", entry: group(), exit: group(), ...overrides };
}

describe("AUTO_PAPER risk gate", () => {
  it("enforces the deployment's maximumOpenPositions (the persisted schema field)", () => {
    expect(evaluateRiskGate(active({ maximumOpenPositions: 2 }), ENTRY, 50_000, 2, 0).rejectReason).toBe("MAX_OPEN_POSITIONS_REACHED");
    expect(evaluateRiskGate(active({ maximumOpenPositions: 8 }), ENTRY, 50_000, 6, 0).passed).toBeTrue();
  });

  it("blocks entries once the daily loss limit is reached, measured from the previous close", () => {
    const limits = active({ maximumDailyLossPercent: 2 });
    const marks = (equity: number) => ({ equity, dayStartEquity: 100_000, peakEquity: 100_000 });
    expect(evaluateRiskGate(limits, ENTRY, 50_000, 0, 0, marks(97_900)).rejectReason).toBe("DAILY_LOSS_LIMIT_REACHED");
    expect(evaluateRiskGate(limits, ENTRY, 50_000, 0, 0, marks(98_500)).passed).toBeTrue();
  });

  it("blocks entries once drawdown from the generation's peak equity reaches the limit", () => {
    const limits = active({ maximumDrawdownPercent: 10 });
    // Flat today (no daily loss) but 12% under the peak.
    const marks = { equity: 88_000, dayStartEquity: 88_000, peakEquity: 100_000 };
    expect(evaluateRiskGate(limits, ENTRY, 50_000, 0, 0, marks).rejectReason).toBe("MAX_DRAWDOWN_REACHED");
    expect(evaluateRiskGate(limits, ENTRY, 50_000, 0, 0, { ...marks, equity: 95_000 }).passed).toBeTrue();
  });

  it("never blocks an exit with exposure limits", () => {
    const limits = active({ maximumOpenPositions: 1, maximumDailyLossPercent: 1, maximumDrawdownPercent: 1 });
    const marks = { equity: 50_000, dayStartEquity: 100_000, peakEquity: 100_000 };
    expect(evaluateRiskGate(limits, EXIT, 0, 5, 0, marks).passed).toBeTrue();
  });
});

describe("AUTO_PAPER entry sizing", () => {
  it("sizes from the strategy's position sizing and account equity instead of one share", () => {
    const def = definition({ risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 10, maximumOpenPositions: 1, allowPyramiding: false } });
    expect(sizeAutoPaperEntry(def, {}, 100_000, 500, undefined)).toEqual({ quantity: 20 });
    expect(sizeAutoPaperEntry(definition({ risk: { sizingMethod: "FIXED_QUANTITY", sizeValue: 7, maximumOpenPositions: 1, allowPyramiding: false } }), {}, 100_000, 500, undefined)).toEqual({ quantity: 7 });
  });

  it("defaults to runner-v3's 100% of equity when the strategy has no risk config", () => {
    expect(sizeAutoPaperEntry(definition(), {}, 100_000, 400, undefined)).toEqual({ quantity: 250 });
  });

  it("caps the position's notional at maximumPositionCapital", () => {
    expect(sizeAutoPaperEntry(definition(), { maximumPositionCapital: 10_000 }, 100_000, 400, undefined)).toEqual({ quantity: 25 });
    expect(sizeAutoPaperEntry(definition(), { maximumPositionCapital: 300 }, 100_000, 400, undefined).quantity).toBe(0);
  });

  it("applies the position-capital cap before deciding the equity cannot fund the entry", () => {
    // 1000 shares at 500 is ₹500,000 > ₹100,000 equity, but the ₹10,000 cap cuts it to 20 shares.
    const def = definition({ risk: { sizingMethod: "FIXED_QUANTITY", sizeValue: 1000, maximumOpenPositions: 1, allowPyramiding: false } });
    expect(sizeAutoPaperEntry(def, { maximumPositionCapital: 10_000 }, 100_000, 500, undefined)).toEqual({ quantity: 20 });
  });

  it("refuses an entry the equity cannot fund", () => {
    const def = definition({ risk: { sizingMethod: "FIXED_QUANTITY", sizeValue: 1000, maximumOpenPositions: 1, allowPyramiding: false } });
    expect(sizeAutoPaperEntry(def, {}, 100_000, 500, undefined)).toEqual({ quantity: 0, rejectReason: "INSUFFICIENT_EQUITY" });
  });
});

describe("AUTO_PAPER direction", () => {
  it("opens SHORT_ONLY strategies with a sell, as runner-v3 does", () => {
    expect(entrySide("SHORT_ONLY")).toBe("SELL");
    expect(entrySide("LONG_ONLY")).toBe("BUY");
    expect(entrySide(undefined)).toBe("BUY");
  });
});

describe("Evaluator warm-up history", () => {
  it("loads several lookbacks of the longest indicator so recursive indicators converge", () => {
    const ema200 = definition({
      entry: group({
        kind: "CONDITION", id: "c", operator: "GREATER_THAN",
        left: { kind: "PRICE", field: "CLOSE" },
        right: { kind: "INDICATOR", indicator: "EMA", params: { period: 200 } },
      }),
    });
    expect(requiredHistoryBars(ema200)).toBeGreaterThanOrEqual(1000);
    expect(requiredHistoryBars(definition())).toBeGreaterThanOrEqual(250);
  });
});

describe("AUTO_PAPER entry re-sizing at the executable quote", () => {
  it("cuts a buy sized on the bar close down to the cap at the quote plus slippage", () => {
    // 20 shares at a 600 quote fill at 600.30: ₹12,006. 16 shares (₹9,604.80) fit ₹10,000.
    expect(resizeEntryForQuote(20, "BUY", { maximumPositionCapital: 10_000 }, 100_000, 600)).toEqual({ quantity: 16 });
    // A short fills at or below the quote.
    expect(resizeEntryForQuote(20, "SELL", { maximumPositionCapital: 10_000 }, 100_000, 600)).toEqual({ quantity: 16 });
  });

  it("re-checks equity at the executable price and never sizes up", () => {
    expect(resizeEntryForQuote(20, "BUY", {}, 10_000, 600)).toEqual({ quantity: 0, rejectReason: "INSUFFICIENT_EQUITY" });
    expect(resizeEntryForQuote(5, "BUY", { maximumPositionCapital: 10_000 }, 100_000, 400)).toEqual({ quantity: 5 });
  });

  it("rejects when the cap cannot buy one share at the quote", () => {
    expect(resizeEntryForQuote(20, "BUY", { maximumPositionCapital: 500 }, 100_000, 600).rejectReason).toBe("MAX_POSITION_CAPITAL_TOO_SMALL");
  });
});

describe("Risk-gate equity marks", () => {
  const position = (symbol: string, unrealizedPnl: string) => ({
    symbol, exchange: "NSE", side: "LONG", totalShares: 100, averageEntryPrice: "1000", unrealizedPnl,
  });

  it("counts a holding's stored loss but not its stored gain when it has no current mark", () => {
    expect(gateUnrealisedPnl(position("INFY", "-10000"), undefined)).toBe(-10_000);
    expect(gateUnrealisedPnl(position("INFY", "10000"), undefined)).toBe(0);
    expect(gateUnrealisedPnl(position("INFY", "0"), 900)).toBe(-10_000);
  });

  it("marks every holding other than the evaluated symbol at its exchange-qualified quote", async () => {
    const state = {
      cash: 100_000, initialCash: 100_000, dayStartEquity: 100_000, snapshotPeakEquity: 100_000,
      positions: [position("TCS", "0"), position("INFY", "0"), position("WIPRO", "5000")],
    };
    const asked: string[] = [];
    const equity = await markPaperEquity(state, { exchange: "NSE", symbol: "TCS", price: 1010 }, async (exchange, symbol) => {
      asked.push(`${exchange}:${symbol}`);
      return symbol === "INFY" ? 900 : undefined;
    });
    // TCS +1,000 at the bar; INFY -10,000 at its quote; WIPRO's unmarked stored gain is ignored.
    expect(equity.equity).toBe(91_000);
    expect(asked.sort()).toEqual(["NSE:INFY", "NSE:WIPRO"]);
  });
});
