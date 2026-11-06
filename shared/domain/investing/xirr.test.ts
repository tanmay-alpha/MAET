import { describe, expect, it } from "bun:test";
import { xirr, type XirrCashFlow } from "./xirr";

// Vendor examples, not rates calculated by the implementation under test:
// https://support.microsoft.com/en-us/excel/functions/xirr-function
// https://help.libreoffice.org/latest/en-US/text/scalc/01/04060118.html#xirr
const excelFlows: XirrCashFlow[] = [
  { amount: -10_000, date: "2008-01-01" },
  { amount: 2_750, date: "2008-03-01" },
  { amount: 4_250, date: "2008-10-30" },
  { amount: 3_250, date: "2009-02-15" },
  { amount: 2_750, date: "2009-04-01" },
];

const twoFlows = (endAmount: number): XirrCashFlow[] => [
  { amount: -100, date: "2021-01-01" },
  { amount: endAmount, date: "2022-01-01" },
];

describe("xirr", () => {
  it("matches the published Excel irregular-cash-flow reference", () => {
    // The vendor's iterative result is specified within 1e-8 in rate.
    expect(xirr(excelFlows)).toBeCloseTo(0.373362535, 8);
  });

  it("matches the published LibreOffice reference to its displayed precision", () => {
    expect(xirr([
      { amount: -10_000, date: "2001-01-01" },
      { amount: 2_000, date: "2001-02-01" },
      { amount: 2_500, date: "2001-03-15" },
      { amount: 5_000, date: "2001-05-12" },
      { amount: 1_000, date: "2001-08-10" },
    ])).toBeCloseTo(0.1828, 4);
  });

  it("returns decimal annual growth for a two-flow round trip", () => {
    expect(xirr(twoFlows(110))).toBeCloseTo(0.1, 10);
  });

  it("returns negative annual returns", () => {
    expect(xirr(twoFlows(50))).toBeCloseTo(-0.5, 10);
  });

  it("returns exact zero for a genuine zero-return investment", () => {
    expect(xirr(twoFlows(100))).toBe(0);
  });

  it("uses actual leap-year days divided by 365, not calendar years", () => {
    expect(xirr([
      { amount: -100, date: "2024-01-01" },
      { amount: 110, date: "2025-01-01" },
    ])).toBeCloseTo(1.1 ** (365 / 366) - 1, 10);
  });

  it("uses whole supplied calendar dates independently of time zones", () => {
    expect(xirr([
      { amount: -100, date: "2024-02-28" },
      { amount: 101, date: "2024-03-01" },
    ])).toBeCloseTo(1.01 ** (365 / 2) - 1, 9);
  });

  it("does not require sorted input or mutate frozen input", () => {
    const flows = Object.freeze([...excelFlows].reverse().map((flow) => Object.freeze({ ...flow })));
    expect(xirr(flows)).toBeCloseTo(0.373362535, 8);
    expect(flows[0]?.date).toBe("2009-04-01");
  });

  it("nets same-day amounts before deciding whether a return exists", () => {
    expect(xirr([
      { amount: -150, date: "2021-01-01" },
      { amount: 50, date: "2021-01-01" },
      { amount: 110, date: "2022-01-01" },
    ])).toBeCloseTo(0.1, 10);
  });

  it("returns null for empty or single-flow portfolios", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ amount: -100, date: "2021-01-01" }])).toBeNull();
  });

  it.each([0, -10])("returns null when there is no positive cash flow (%s)", (amount) => {
    expect(xirr(twoFlows(amount))).toBeNull();
  });

  it("returns null for only positive or only zero cash flows", () => {
    expect(xirr(twoFlows(110).map((flow) => ({ ...flow, amount: Math.abs(flow.amount) })))).toBeNull();
    expect(xirr(twoFlows(0).map((flow) => ({ ...flow, amount: 0 })))).toBeNull();
  });

  it.each([100, 110])("returns null for same-day flows even if their sum is %s", (amount) => {
    expect(xirr([
      { amount: -100, date: "2021-01-01" },
      { amount, date: "2021-01-01" },
    ])).toBeNull();
  });

  it("returns null for a zero polynomial after same-day cancellation", () => {
    expect(xirr([
      { amount: -100, date: "2021-01-01" },
      { amount: 100, date: "2021-01-01" },
      { amount: 0, date: "2022-01-01" },
    ])).toBeNull();
  });

  it("returns null for mixed-sign cash flows with no real admissible root", () => {
    expect(xirr([
      { amount: -100, date: "2021-01-01" },
      { amount: 100, date: "2022-01-01" },
      { amount: -100, date: "2023-01-01" },
    ])).toBeNull();
  });

  it("does not mistake a vanished future NPV at extreme rates for a root", () => {
    expect(xirr([
      { amount: -100, date: "2021-01-01" },
      { amount: 100, date: "2021-01-01" },
      { amount: 100, date: "2022-01-01" },
      { amount: -1, date: "2023-01-01" },
    ])).toBeCloseTo(-0.99, 10);
  });

  it("handles returns near minus 100 percent and very large positive rates", () => {
    expect(xirr(twoFlows(0.000001))).toBeCloseTo(-0.99999999, 12);
    const rate = xirr(twoFlows(100_000_000));
    expect(rate).not.toBeNull();
    expect(Math.abs(rate! / 999_999 - 1)).toBeLessThan(1e-9);
  });

  it("uses bisection when the default Newton derivative vanishes", () => {
    const rate = xirr([
      { amount: -100, date: "2021-01-01" },
      { amount: 242, date: "2022-01-01" },
      { amount: -133.1, date: "2023-01-01" },
    ]);
    const roots = [(242 - Math.sqrt(5324)) / 200 - 1, (242 + Math.sqrt(5324)) / 200 - 1];
    expect(rate).not.toBeNull();
    expect(Math.min(...roots.map((root) => Math.abs(root - rate!)))).toBeLessThan(1e-9);
  });

  it("selects the default-guess root deterministically when multiple roots exist", () => {
    expect(xirr([
      { amount: -100, date: "2021-01-01" },
      { amount: 230, date: "2022-01-01" },
      { amount: -132, date: "2023-01-01" },
    ])).toBeCloseTo(0.1, 9);
  });

  it.each([1e-200, 1e200])("is invariant under cash-flow scaling by %s", (scale) => {
    expect(xirr(excelFlows.map((flow) => ({ ...flow, amount: flow.amount * scale })))).toBeCloseTo(0.373362535, 8);
  });

  it.each(["2023-02-29", "2024-13-01", "2024-1-01", "2024-01-01T00:00:00Z", "invalid"])("returns null for invalid ISO date %s", (date) => {
    expect(xirr([{ amount: -100, date }, { amount: 110, date: "2025-01-01" }])).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("returns JSON-safe null for non-finite amount %s", (amount) => {
    expect(xirr(twoFlows(amount))).toBeNull();
  });
});
