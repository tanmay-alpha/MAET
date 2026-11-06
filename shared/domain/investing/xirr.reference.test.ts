/**
 * XIRR against spreadsheet references and a separate solver, not against the
 * implementation's own arithmetic.
 *
 * Published results (fetched 2026-11-07):
 * - Excel: =XIRR on -10,000 (1-Jan-08), 2,750 (1-Mar-08), 4,250 (30-Oct-08), 3,250 (15-Feb-09),
 *   2,750 (1-Apr-09) is 0.373362535; flows are "discounted based on a 365-day year".
 *   https://support.microsoft.com/en-us/office/xirr-function-de1242ec-6477-445b-b11b-a303ad9adc9d
 * - LibreOffice Calc: =XIRR on -10000 (2001-01-01), 2000 (2001-02-01), 2500 (2001-03-15),
 *   5000 (2001-05-12), 1000 (2001-08-10) returns 0.1828.
 *   https://help.libreoffice.org/latest/en-US/text/scalc/01/04060118.html
 * The other sets were also solved with SciPy brentq (xtol 1e-15) on the same ACT/365 equation;
 * those roots are the literals below, and the in-test bisection re-derives them.
 */
import { describe, expect, it } from "bun:test";
import { xirr, type XirrCashFlow } from "./xirr";

const flows = (rows: Array<[string, number]>): XirrCashFlow[] => rows.map(([date, amount]) => ({ date, amount }));

/** Independent reference: plain bisection on sum(a / (1 + r)^(days / 365)) over (-1, 1000]. */
function bisectXirr(cashFlows: XirrCashFlow[]): number {
  const day = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
  const first = Math.min(...cashFlows.map((flow) => day(flow.date)));
  const npv = (rate: number) => cashFlows.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** ((day(flow.date) - first) / 365), 0);
  let low = -0.999999;
  let high = 1000;
  if (Math.sign(npv(low)) === Math.sign(npv(high))) throw new Error("no bracket");
  for (let step = 0; step < 300; step++) {
    const mid = (low + high) / 2;
    if (Math.sign(npv(mid)) === Math.sign(npv(low))) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

const CASES: Array<{ name: string; flows: XirrCashFlow[]; scipy: number }> = [
  {
    name: "Excel documentation example",
    flows: flows([["2008-01-01", -10000], ["2008-03-01", 2750], ["2008-10-30", 4250], ["2009-02-15", 3250], ["2009-04-01", 2750]]),
    scipy: 0.37336253351883153,
  },
  {
    name: "LibreOffice documentation example",
    flows: flows([["2001-01-01", -10000], ["2001-02-01", 2000], ["2001-03-15", 2500], ["2001-05-12", 5000], ["2001-08-10", 1000]]),
    scipy: 0.18284348582078377,
  },
  {
    name: "negative return",
    flows: flows([["2023-04-10", -100000], ["2023-09-01", 20000], ["2024-06-15", 60000]]),
    scipy: -0.2001871063881214,
  },
  {
    name: "ten-year span with two leap days and staggered buys",
    flows: flows([["2015-02-28", -50000], ["2016-02-29", -25000], ["2020-03-01", 10000], ["2025-12-31", 120000]]),
    scipy: 0.05656656220530878,
  },
  {
    name: "several flows on the same days",
    flows: flows([["2024-01-01", -10000], ["2024-01-01", -5000], ["2024-01-01", 3000], ["2024-03-15", -2000], ["2024-03-15", 2500], ["2024-07-01", 14000]]),
    scipy: 0.47390799045460963,
  },
  {
    name: "monthly SIP sold at a loss on 31 Mar",
    flows: flows([["2022-04-05", -10000], ["2022-05-05", -10000], ["2022-06-06", -10000], ["2022-07-05", -10000], ["2022-08-05", -10000], ["2023-03-31", 48500]]),
    scipy: -0.03651122213751426,
  },
];

describe("xirr against spreadsheet and independent references", () => {
  for (const { name, flows: cashFlows, scipy } of CASES) {
    it(`matches the independent root for the ${name}`, () => {
      const result = xirr(cashFlows);
      expect(result).not.toBeNull();
      expect(Math.abs(result! - scipy)).toBeLessThan(1e-10);
      expect(Math.abs(result! - bisectXirr(cashFlows))).toBeLessThan(1e-10);
    });
  }

  it("reproduces the published spreadsheet results within their stated precision", () => {
    // Excel iterates until "accurate within 0.000001 percent"; the exact root is 0.37336253352.
    expect(xirr(CASES[0]!.flows)!).toBeCloseTo(0.373362535, 8);
    expect(Number(xirr(CASES[1]!.flows)!.toFixed(4))).toBe(0.1828);
  });

  it("counts actual days over a fixed 365-day year", () => {
    // 2023-01-01 → 2024-01-01 is 365 days: exactly 10%. 2024-01-01 → 2025-01-01 is 366 days.
    expect(xirr(flows([["2023-01-01", -1000], ["2024-01-01", 1100]]))!).toBeCloseTo(0.1, 12);
    expect(xirr(flows([["2024-01-01", -1000], ["2025-01-01", 1100]]))!).toBeCloseTo(1.1 ** (365 / 366) - 1, 12);
  });

  it("returns the same rate whatever the input order (Excel requires the first row earliest)", () => {
    expect(xirr([...CASES[0]!.flows].reverse())!).toBeCloseTo(CASES[0]!.scipy, 12);
  });

  it("returns null where Excel and Calc return #NUM!", () => {
    // 100 − 50v + 100v² has no real root (discriminant 2,500 − 40,000 < 0): NPV ≥ 93.75 for every rate.
    expect(xirr(flows([["2021-01-01", 100], ["2022-01-01", -50], ["2023-01-01", 100]]))).toBeNull();
    // No sign change at all.
    expect(xirr(flows([["2021-01-01", -100], ["2022-01-01", -50]]))).toBeNull();
    // A single net date once same-day flows are summed.
    expect(xirr(flows([["2021-01-01", -100], ["2021-01-01", 120]]))).toBeNull();
  });
});
