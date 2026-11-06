import { describe, expect, it } from "bun:test";
import { trpc } from "../lib/trpc";
import { closedTrades, rupees, signedRupees } from "./-journal";

describe("Journal", () => {
  it("reviews only paper positions that are flat", () => {
    const positions = [
      { symbol: "RELIANCE", totalShares: 0 },
      { symbol: "TCS", totalShares: 5 },
      { symbol: "INFY", totalShares: 0 },
    ];

    expect(closedTrades(positions).map((p) => p.symbol)).toEqual(["RELIANCE", "INFY"]);
    expect(closedTrades([])).toEqual([]);
  });

  it("shows the realised P&L the account reports, with its sign", () => {
    expect(signedRupees(1234.5)).toBe("+₹1,234.50");
    expect(signedRupees(-80)).toBe("−₹80.00");
    expect(signedRupees(0)).toBe("₹0.00");
  });

  it("shows a dash for a missing or unparseable price", () => {
    expect(rupees(null)).toBe("—");
    expect(rupees("n/a")).toBe("—");
    expect(rupees("2450.5")).toBe("₹2,450.50");
  });

  it("exposes the thesis-list client procedure required by Journal", () => {
    const tradeTheses = Reflect.get(trpc, "tradeTheses") as { list?: { useQuery?: unknown } } | undefined;

    expect(typeof tradeTheses?.list?.useQuery).toBe("function");
  });
});
