/**
 * runner-v3 never applies stored corporate actions passed as `unappliedCorporateActions` (stored
 * Yahoo candles are already split-adjusted, docs/RESEARCH_ENGINE.md §7); it lists those inside the
 * run window in `warnings` so users see them.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { unappliedCorporateActionsWarning, type CorporateAction } from "../data/corporate-actions";
import { runBacktestV3 } from "./runner-v3";

const DAY = 86_400_000;
/** 2024-10-01 09:15 IST. */
const FIRST_BAR = Date.UTC(2024, 9, 1, 3, 45);

const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
  const close = 1300 + (i % 7) * 5;
  return {
    symbol: "RELIANCE", tf: "1d", ts: new Date(FIRST_BAR + i * DAY).toISOString(),
    open: close - 2, high: close + 5, low: close - 5, close, volume: 1_000_000, source: "yahoo",
  };
});
// Bars run 2024-10-01 .. 2024-11-29 (IST).

const definition: StrategyDefinition = {
  name: "always-in",
  direction: "LONG_ONLY",
  entry: {
    kind: "GROUP", id: "e", combinator: "AND",
    children: [{ kind: "CONDITION", id: "e1", left: { kind: "PRICE", field: "CLOSE", lag: 0 }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 0 } }],
  },
  exit: { kind: "GROUP", id: "x", combinator: "OR", children: [] },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "NONE", slippageBps: 0, initialCapital: 100_000 },
};

const bonus: CorporateAction = { symbol: "RELIANCE", actionType: "SPLIT", exDate: "2024-10-28", ratioNumerator: 2, ratioDenominator: 1, source: "yahoo" };
const dividend: CorporateAction = { symbol: "RELIANCE", actionType: "DIVIDEND", exDate: "2024-11-29", amount: 5.5, currency: "INR", source: "yahoo" };
const before: CorporateAction = { symbol: "RELIANCE", actionType: "DIVIDEND", exDate: "2024-08-19", amount: 5, currency: "INR" };
const after: CorporateAction = { symbol: "RELIANCE", actionType: "DIVIDEND", exDate: "2024-11-30", amount: 1, currency: "INR" };

const run = (unappliedCorporateActions?: CorporateAction[]) =>
  runBacktestV3({ strategyVersionId: "corp-actions", definition, symbol: "RELIANCE", candles, timeframe: "1d", unappliedCorporateActions });

describe("backtest warning for corporate actions inside the run window", () => {
  it("lists the actions whose IST ex-date falls inside the run, oldest first, including the last bar's date", () => {
    const result = run([dividend, after, bonus, before]);
    const warning = result.warnings.filter((w) => w.startsWith("CORPORATE_ACTIONS_IN_WINDOW"));
    expect(warning).toEqual([
      "CORPORATE_ACTIONS_IN_WINDOW: 2 corporate action(s) between 2024-10-01 and 2024-11-29 are not applied to these prices: "
        + "split/bonus 2:1 ex 2024-10-28; dividend INR 5.5 ex 2024-11-29. "
        + "Yahoo split-adjusts candles as of the day they were fetched, and dividends are not added to returns.",
    ]);
  });

  it("leaves prices, trades and the data hash untouched: the actions are reported, not applied", () => {
    const plain = run();
    const warned = run([bonus, dividend]);
    expect(warned.dataHash).toBe(plain.dataHash);
    expect(warned.equityCurve).toEqual(plain.equityCurve);
    expect(warned.trades.map((t) => [t.entryPrice, t.exitPrice])).toEqual(plain.trades.map((t) => [t.entryPrice, t.exitPrice]));
    expect(warned.corporateActionCount).toBe(0);
  });

  it("adds no warning when no action falls inside the window", () => {
    expect(run([before, after]).warnings.some((w) => w.startsWith("CORPORATE_ACTIONS_IN_WINDOW"))).toBe(false);
    expect(run().warnings.some((w) => w.startsWith("CORPORATE_ACTIONS_IN_WINDOW"))).toBe(false);
  });

  it("uses the trading window, not the warm-up bars", () => {
    const tradeFrom = new Date(FIRST_BAR + 40 * DAY).toISOString(); // 2024-11-10
    const result = runBacktestV3({ strategyVersionId: "corp-actions", definition, symbol: "RELIANCE", candles, tradeFrom, unappliedCorporateActions: [bonus, dividend] });
    expect(result.warnings.find((w) => w.startsWith("CORPORATE_ACTIONS_IN_WINDOW"))).toContain("1 corporate action(s) between 2024-11-09 and 2024-11-29");
  });
});

describe("unappliedCorporateActionsWarning", () => {
  it("compares stored instants by their IST date", () => {
    // Midnight IST on 28 Oct is 27 Oct in UTC.
    const stored = { ...bonus, exDate: new Date("2024-10-27T18:30:00.000Z") };
    expect(unappliedCorporateActionsWarning([stored], "2024-10-28T03:45:00.000Z", "2024-10-28T03:45:00.000Z")).toContain("split/bonus 2:1 ex 2024-10-28");
    expect(unappliedCorporateActionsWarning([stored], "2024-10-29T03:45:00.000Z", "2024-11-01T03:45:00.000Z")).toBeNull();
  });

  it("caps the list and counts the rest", () => {
    const many = Array.from({ length: 12 }, (_, i): CorporateAction => ({ ...dividend, exDate: `2024-10-${String(i + 2).padStart(2, "0")}` }));
    const warning = unappliedCorporateActionsWarning(many, "2024-10-01T00:00:00Z", "2024-11-01T00:00:00Z")!;
    expect(warning).toStartWith("CORPORATE_ACTIONS_IN_WINDOW: 12 corporate action(s)");
    expect(warning).toContain("; and 2 more.");
  });
});
