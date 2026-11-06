/**
 * Boundary cases computed by hand from primary sources, independently of the estimator's
 * own tests. Sources, fetched 2026-11-07:
 * - Income-tax Act 1961 s111A (15% before 23 Jul 2024, 20% on/after), Income Tax Department:
 *   https://wm.incometaxindia.gov.in/w/section-111a
 * - s112A(2)(i) (10% / 12.5% split on 23 Jul 2024; proviso: the ₹1,25,000 limit applies to
 *   the aggregate of both rate groups; substituted by Finance (No. 2) Act 2024, Act 15 of 2024):
 *   https://wm.incometaxindia.gov.in/w/section-112a-65
 * - CBDT FAQs, PIB 24 Jul 2024, Q2 (new rates for transfers on/after 23.7.2024) and Q7
 *   (₹1.25 lakh applies for FY 2024-25 and later): https://www.pib.gov.in/PressReleasePage.aspx?PRID=2036604
 * - s70(2)/(3): STCL against any capital gain, LTCL only against LTCG; which gain absorbs the
 *   loss is the assessee's statutory choice, upheld in K2 Family (P.) Trust v. DCIT, Bombay HC,
 *   WP (L) 38249 of 2025, 15 Dec 2025: https://wm.incometaxindia.gov.in/w/section-70-128
 * - s2(42A): listed shares are short-term if held "not more than twelve months immediately
 *   preceding the date of its transfer"; months are calendar months (General Clauses Act s3(35)).
 * - s43(5): non-delivery settlement is speculative, not a capital gain.
 * - s48: no deduction for securities transaction tax: https://wm.incometaxindia.gov.in/w/section-48-65
 * - Income-tax Act 2025 (transfers from 1 Apr 2026) ss196/198 keep 20%, 12.5% and ₹1,25,000:
 *   https://wm.incometaxindia.gov.in/w/section-196-78, https://wm.incometaxindia.gov.in/w/section-198-76
 */
import { describe, expect, it } from "bun:test";
import { buildCapitalGainsReport, type Fill } from "./capital-gains";

let sequence = 0;
/** One share bought at `buy` and sold at `sell`, in its own symbol so FIFO cannot mix trades. */
function round(entry: string, exit: string, buy: number, sell: number): Fill[] {
  const symbol = `S${++sequence}`;
  return [
    { id: `${symbol}-b`, generation: 1, symbol, exchange: "NSE", side: "BUY", quantity: 1, price: buy, date: entry },
    { id: `${symbol}-s`, generation: 1, symbol, exchange: "NSE", side: "SELL", quantity: 1, price: sell, date: exit },
  ];
}
const gain = (entry: string, exit: string, amount: number) => round(entry, exit, 1_000_000, 1_000_000 + amount);

describe("capital gains against the statute", () => {
  it("switches 111A from 15% to 20% for transfers on 23 Jul 2024", () => {
    const report = buildCapitalGainsReport([...gain("2024-06-01", "2024-07-22", 10_000), ...gain("2024-06-01", "2024-07-23", 10_000)], 2024, 1);
    // 10,000 × 15% + 10,000 × 20% = 1,500 + 2,000 = 3,500; cess 4% = 140.
    expect(report.baseTax).toBeCloseTo(3_500, 6);
    expect(report.estimatedTax).toBeCloseTo(3_640, 6);
  });

  it("keeps a sale on the first anniversary short-term even across a leap day (366 days)", () => {
    // 2024-01-15 → 2025-01-15 is exactly twelve calendar months (366 days): not more than twelve.
    const exact = buildCapitalGainsReport(gain("2024-01-15", "2025-01-15", 50_000), 2024, 1);
    expect(exact.grossStcg).toBe(50_000);
    expect(exact.grossLtcg).toBe(0);
    expect(exact.baseTax).toBeCloseTo(10_000, 6); // 50,000 × 20%
    const nextDay = buildCapitalGainsReport(gain("2024-01-15", "2025-01-16", 50_000), 2024, 1);
    expect(nextDay.grossLtcg).toBe(50_000);
    expect(nextDay.baseTax).toBe(0); // within the ₹1,25,000 exemption
  });

  it("claims the transition-FY exemption against 12.5% gains before 10% gains", () => {
    const report = buildCapitalGainsReport([...gain("2022-01-03", "2024-07-22", 150_000), ...gain("2022-01-03", "2024-07-23", 150_000)], 2024, 1);
    // Exemption 1,25,000 against the 12.5% gain: 25,000 × 12.5% + 1,50,000 × 10% = 3,125 + 15,000.
    // The other order would be 1,50,000 × 12.5% + 25,000 × 10% = 21,250, ₹3,125 more.
    expect(report.exemptionUsed).toBe(125_000);
    expect(report.baseTax).toBeCloseTo(18_125, 6);
    expect(report.estimatedTax).toBeCloseTo(18_850, 6);
  });

  it("applies ₹1,25,000 to all of FY2024-25 and ₹1,00,000 to FY2023-24", () => {
    const transition = buildCapitalGainsReport(gain("2022-01-03", "2024-05-10", 125_000), 2024, 1);
    expect(transition.baseTax).toBe(0);
    const before = buildCapitalGainsReport(gain("2022-01-03", "2024-03-28", 125_000), 2023, 1);
    expect(before.baseTax).toBeCloseTo(2_500, 6); // (1,25,000 − 1,00,000) × 10%
  });

  it("sets a short-term loss against the 20% gain before the 15% gain", () => {
    const report = buildCapitalGainsReport(
      [...gain("2024-06-03", "2024-07-01", 10_000), ...gain("2024-06-03", "2024-07-02", -10_000), ...gain("2024-06-03", "2024-08-01", 10_000)],
      2024,
      1,
    );
    // The 10,000 loss absorbs the 20% gain; 10,000 remains at 15% = 1,500 (not 2,000).
    expect(report.baseTax).toBeCloseTo(1_500, 6);
    expect(report.unabsorbedStcl).toBe(0);
  });

  it("never sets a long-term loss against short-term gains", () => {
    const report = buildCapitalGainsReport([...gain("2022-01-03", "2025-09-01", -50_000), ...gain("2025-06-02", "2025-09-02", 50_000)], 2025, 1);
    expect(report.baseTax).toBeCloseTo(10_000, 6); // 50,000 × 20%
    expect(report.unabsorbedLtcl).toBe(50_000);
  });

  it("sets a short-term loss against long-term gains once short-term gains are exhausted, before the exemption", () => {
    const report = buildCapitalGainsReport([...gain("2025-06-02", "2025-09-01", -200_000), ...gain("2022-01-03", "2025-09-02", 300_000)], 2025, 1);
    // 3,00,000 − 2,00,000 = 1,00,000 long-term, inside the exemption.
    expect(report.exemptionUsed).toBe(100_000);
    expect(report.baseTax).toBe(0);
    expect(report.unabsorbedStcl).toBe(0);
  });

  it("assigns 31 Mar to the closing FY and 1 Apr to the next", () => {
    const fills = [...gain("2025-01-02", "2025-03-31", 1_000), ...gain("2025-01-02", "2025-04-01", 2_000)];
    expect(buildCapitalGainsReport(fills, 2024, 1).grossStcg).toBe(1_000);
    expect(buildCapitalGainsReport(fills, 2025, 1).grossStcg).toBe(2_000);
  });

  it("keeps intraday rounds and overnight shorts out of 111A/112A", () => {
    const fills: Fill[] = [
      ...round("2025-08-01", "2025-08-01", 100, 150),
      { id: "short", generation: 1, symbol: "SHRT", exchange: "NSE", side: "SELL", quantity: 1, price: 200, date: "2025-08-04" },
      { id: "cover", generation: 1, symbol: "SHRT", exchange: "NSE", side: "BUY", quantity: 1, price: 120, date: "2025-08-20" },
    ];
    const report = buildCapitalGainsReport(fills, 2025, 1);
    expect(report.grossStcg).toBe(0);
    expect(report.intradayPnl).toBe(50);
    expect(report.overnightShortPnl).toBe(80);
    expect(report.matchedLots.map((lot) => lot.kind)).toEqual(["intraday", "short"]);
    expect(report.baseTax).toBe(0);
  });

  it("does not deduct supplied charges, so STT never reduces the gain", () => {
    const fills = gain("2025-06-02", "2025-09-01", 10_000).map((fill) => ({ ...fill, fee: 25 }));
    expect(buildCapitalGainsReport(fills, 2025, 1).baseTax).toBeCloseTo(2_000, 6);
  });
});
