import { describe, expect, it } from "bun:test";
import { buildCapitalGainsReport, matchFifoLots, type CapitalGainsReport, type Fill } from "./capital-gains";

function fill(id: string, side: Fill["side"], quantity: number, price: number, date: string, extra: Partial<Fill> = {}): Fill {
  return { id, generation: 1, symbol: "ABC", exchange: "NSE", side, quantity, price, date, ...extra };
}
function trade(id: string, entry: string, exit: string, pnl: number): Fill[] {
  const price = Math.max(1, 1 - pnl);
  return [fill(`${id}-buy`, "BUY", 1, price, entry, { symbol: id }), fill(`${id}-sell`, "SELL", 1, price + pnl, exit, { symbol: id })];
}
function bucket(report: CapitalGainsReport, term: "STCG" | "LTCG", regime: "old" | "new") {
  return report.buckets.find((value) => value.term === term && value.regime === regime)!;
}

describe("matchFifoLots", () => {
  it("matches partial lots in FIFO order, preserves equal-date input order and does not mutate input", () => {
    const fills = [fill("z", "BUY", 3, 100, "2024-01-01"), fill("a", "BUY", 4, 120, "2024-01-01"), fill("sale", "SELL", 5, 150, "2024-02-01")];
    const original = JSON.stringify(fills);
    const result = matchFifoLots(fills, 1);
    expect(result.map((lot) => [lot.entryFillId, lot.quantity, lot.grossPnl])).toEqual([["z", 3, 150], ["a", 2, 60]]);
    expect(result[0]).toMatchObject({ entryDate: "2024-01-01", exitDate: "2024-02-01", entryPrice: 100, exitPrice: 150, side: "LONG", kind: "delivery" });
    expect(JSON.stringify(fills)).toBe(original);
  });

  it("isolates exchanges, symbols and generations, sorts dates and ignores open lots", () => {
    const fills = [fill("exit", "SELL", 1, 200, "2024-02-01"), fill("wrong-generation", "BUY", 1, 1, "2024-01-01", { generation: 2 }), fill("wrong-exchange", "BUY", 1, 1, "2024-01-01", { exchange: "BSE" }), fill("wrong-symbol", "BUY", 1, 1, "2024-01-01", { symbol: "XYZ" }), fill("entry", "BUY", 2, 100, "2024-01-01")];
    expect(matchFifoLots(fills, 1).map((lot) => [lot.entryFillId, lot.exitFillId, lot.grossPnl])).toEqual([["entry", "exit", 100]]);
  });

  it("handles short partial covers and crossing through zero into a new long position", () => {
    const result = matchFifoLots([fill("short", "SELL", 5, 100, "2024-01-01"), fill("cover", "BUY", 2, 80, "2024-01-02"), fill("cross", "BUY", 5, 90, "2024-01-03"), fill("sell", "SELL", 2, 110, "2024-01-04")], 1);
    expect(result.map((lot) => [lot.side, lot.kind, lot.quantity, lot.grossPnl])).toEqual([["SHORT", "short", 2, 40], ["SHORT", "short", 3, 30], ["LONG", "delivery", 2, 40]]);
    expect(result[2]!.entryFillId).toBe("cross");
  });

  it("classifies both same-day long and short rounds as intraday", () => {
    const lots = matchFifoLots([fill("b", "BUY", 1, 100, "2024-01-01"), fill("s", "SELL", 2, 120, "2024-01-01"), fill("c", "BUY", 1, 130, "2024-01-01")], 1);
    expect(lots.map((lot) => [lot.side, lot.kind, lot.grossPnl])).toEqual([["LONG", "intraday", 20], ["SHORT", "intraday", -10]]);
  });

  it("nets same-day buys and sells before consuming historical long inventory", () => {
    const report = buildCapitalGainsReport([fill("old", "BUY", 10, 100, "2024-08-01"), fill("day-buy", "BUY", 5, 110, "2024-08-02"), fill("day-sell", "SELL", 5, 120, "2024-08-02"), fill("close-old", "SELL", 10, 130, "2024-08-03")], 2024, 1);
    expect(report.matchedLots.map((lot) => [lot.entryFillId, lot.exitFillId, lot.quantity, lot.kind, lot.grossPnl])).toEqual([["day-buy", "day-sell", 5, "intraday", 50], ["old", "close-old", 10, "delivery", 300]]);
    expect(report.intradayPnl).toBe(50);
    expect(report.grossStcg).toBe(300);
  });

  it("keeps short-first daily chronology and sends only partial unmatched day quantities into delivery FIFO", () => {
    const lots = matchFifoLots([fill("old", "BUY", 10, 100, "2024-08-01"), fill("day-sell", "SELL", 8, 120, "2024-08-02"), fill("day-buy", "BUY", 5, 110, "2024-08-02"), fill("close-old", "SELL", 7, 130, "2024-08-03")], 1);
    expect(lots.map((lot) => [lot.entryFillId, lot.exitFillId, lot.quantity, lot.side, lot.kind, lot.grossPnl])).toEqual([["day-sell", "day-buy", 5, "SHORT", "intraday", 50], ["old", "day-sell", 3, "LONG", "delivery", 60], ["old", "close-old", 7, "LONG", "delivery", 210]]);
  });

  it("retains historical shorts when a new same-day long round is squared off", () => {
    const lots = matchFifoLots([fill("old-short", "SELL", 10, 100, "2024-08-01"), fill("day-buy", "BUY", 5, 80, "2024-08-02"), fill("day-sell", "SELL", 5, 90, "2024-08-02"), fill("cover-old", "BUY", 10, 70, "2024-08-03")], 1);
    expect(lots.map((lot) => [lot.entryFillId, lot.exitFillId, lot.quantity, lot.kind, lot.grossPnl])).toEqual([["day-buy", "day-sell", 5, "intraday", 50], ["old-short", "cover-old", 10, "short", 300]]);
  });

  it("supports fractional quantities without manufacturing residual open shorts", () => {
    const lots = matchFifoLots([fill("b1", "BUY", 0.1, 100, "2024-01-01"), fill("b2", "BUY", 0.2, 100, "2024-01-02"), fill("s", "SELL", 0.3, 110, "2024-01-03"), fill("fresh", "BUY", 1, 100, "2024-01-04")], 1);
    expect(lots).toHaveLength(2);
    expect(lots.reduce((sum, lot) => sum + lot.grossPnl, 0)).toBeCloseTo(3, 10);
  });
});

describe("buildCapitalGainsReport", () => {
  it("uses an inclusive April 1 through March 31 exit-date FY and full entry history", () => {
    const report = buildCapitalGainsReport([...trade("before", "2022-01-01", "2024-03-31", 500), ...trade("first", "2022-01-01", "2024-04-01", 100), ...trade("last", "2024-04-01", "2025-03-31", 200), ...trade("after", "2024-04-01", "2025-04-01", 700)], 2024, 1);
    expect(report.financialYearStart).toBe(2024);
    expect(report.startDate).toBe("2024-04-01");
    expect(report.endDate).toBe("2025-03-31");
    expect(report.grossLtcg).toBe(100);
    expect(report.grossStcg).toBe(200);
    expect(report.matchedLots).toHaveLength(2);
  });

  it("treats exactly twelve calendar months as STCG, next day as LTCG, including leap anniversaries", () => {
    const report = buildCapitalGainsReport([...trade("equal", "2023-07-22", "2024-07-22", 100), ...trade("beyond", "2023-07-21", "2024-07-22", 200), ...trade("leapEqual", "2024-02-29", "2025-02-28", 300), ...trade("leapBeyond", "2024-02-29", "2025-03-01", 400)], 2024, 1);
    expect(report.grossStcg).toBe(400);
    expect(report.grossLtcg).toBe(600);
  });

  it("changes rates on July 23, 2024 and applies one aggregate 125000 exemption to the transition FY", () => {
    const report = buildCapitalGainsReport([...trade("stOld", "2024-07-01", "2024-07-22", 10000), ...trade("stNew", "2024-07-01", "2024-07-23", 10000), ...trade("ltOld", "2022-01-01", "2024-07-22", 150000), ...trade("ltNew", "2022-01-01", "2024-07-23", 150000)], 2024, 1);
    expect(bucket(report, "STCG", "old").tax).toBe(1500);
    expect(bucket(report, "STCG", "new").tax).toBe(2000);
    expect(bucket(report, "LTCG", "old").taxableGain).toBe(25000);
    expect(bucket(report, "LTCG", "new").taxableGain).toBe(150000);
    expect(report.exemptionLimit).toBe(125000);
    expect(report.exemptionUsed).toBe(125000);
    expect(report.baseTax).toBe(24750);
    expect(report.cess).toBe(990);
    expect(report.estimatedTax).toBe(25740);
  });

  it("uses the whole transition FY exemption even when all transfers precede July 23", () => {
    const report = buildCapitalGainsReport(trade("oldOnly", "2022-01-01", "2024-04-01", 125000), 2024, 1);
    expect(report.exemptionUsed).toBe(125000);
    expect(report.estimatedTax).toBe(0);
  });

  it("uses old 1 lakh and new 1.25 lakh exemption boundaries without taxing the exemption", () => {
    const old = buildCapitalGainsReport(trade("old", "2020-01-01", "2023-04-01", 100001), 2023, 1);
    expect(old.exemptionLimit).toBe(100000);
    expect(old.exemptionUsed).toBe(100000);
    expect(old.baseTax).toBeCloseTo(0.1, 10);
    const current = buildCapitalGainsReport(trade("new", "2020-01-01", "2025-04-01", 125001), 2025, 1);
    expect(current.exemptionLimit).toBe(125000);
    expect(current.baseTax).toBeCloseTo(0.125, 10);
  });

  it("sets LTCL only against LTCG and STCL against STCG then LTCG, old buckets first", () => {
    const report = buildCapitalGainsReport([...trade("stGainOld", "2024-01-01", "2024-07-22", 100), ...trade("stGainNew", "2024-01-01", "2024-07-23", 300), ...trade("stLoss", "2024-01-01", "2024-08-01", -500), ...trade("ltGainOld", "2020-01-01", "2024-07-22", 200000), ...trade("ltGainNew", "2020-01-01", "2024-07-23", 200000), ...trade("ltLoss", "2020-01-01", "2024-09-01", -50000)], 2024, 1);
    // ST new internally nets 300 - 500 = -200; ST old consumes 100, then LT old 100.
    // LT new internally nets 200000 - 50000 = 150000; then old exemption consumes 125000.
    expect(bucket(report, "STCG", "old").lossOffset).toBe(100);
    expect(bucket(report, "LTCG", "old").lossOffset).toBe(100);
    expect(bucket(report, "LTCG", "old").taxableGain).toBe(74900);
    expect(bucket(report, "LTCG", "new").taxableGain).toBe(150000);
    expect(report.unabsorbedStcl).toBe(0);
    expect(report.unabsorbedLtcl).toBe(0);
  });

  it("uses residual LTCL across LT rates before STCL, never against ST gains", () => {
    const report = buildCapitalGainsReport([...trade("st", "2024-01-01", "2024-07-23", 1000), ...trade("lt", "2020-01-01", "2024-07-22", 100000), ...trade("loss", "2020-01-01", "2024-07-23", -150000)], 2024, 1);
    expect(report.unabsorbedLtcl).toBe(50000);
    expect(report.grossLtcg).toBe(-50000);
    expect(report.exemptionUsed).toBe(0);
    expect(bucket(report, "STCG", "new").taxableGain).toBe(1000);
    expect(report.estimatedTax).toBe(208);
  });

  it("reports unused STCL, zero tax and zero exemption on losses", () => {
    const report = buildCapitalGainsReport([...trade("st", "2024-01-01", "2024-07-23", -150000), ...trade("lt", "2020-01-01", "2024-07-23", 10000)], 2024, 1);
    expect(report.unabsorbedStcl).toBe(140000);
    expect(report.estimatedTax).toBe(0);
    expect(report.exemptionUsed).toBe(0);
  });

  it("excludes speculative and overnight short rounds from capital tax and records absolute intraday turnover", () => {
    const report = buildCapitalGainsReport([...trade("dayWin", "2024-08-01", "2024-08-01", 100), ...trade("dayLoss", "2024-08-01", "2024-08-01", -40), fill("short", "SELL", 2, 100, "2024-08-02", { symbol: "SHORT" }), fill("cover", "BUY", 2, 90, "2024-08-03", { symbol: "SHORT" })], 2024, 1);
    expect(report.intradayPnl).toBe(60);
    expect(report.intradayTurnover).toBe(140);
    expect(report.overnightShortPnl).toBe(20);
    expect(report.grossStcg).toBe(0);
    expect(report.grossLtcg).toBe(0);
    expect(report.estimatedTax).toBe(0);
  });

  it("ignores separately supplied fees, explains assumptions and remains JSON serializable", () => {
    const report = buildCapitalGainsReport(trade("fees", "2024-01-01", "2024-08-01", 1000).map((value) => ({ ...value, fee: 100 })), 2024, 1);
    expect(report.grossStcg).toBe(1000);
    expect(report.assumptions.join(" ")).toContain("not tax advice");
    expect(report.assumptions.join(" ")).toContain("STT");
    expect(report.assumptions.join(" ")).toContain("not an optimal");
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("returns a complete empty report", () => {
    const report = buildCapitalGainsReport([], 2024, 1);
    expect(report.matchedLots).toEqual([]);
    expect(report.buckets).toHaveLength(4);
    expect(report.baseTax).toBe(0);
    expect(report.cess).toBe(0);
    expect(report.exemptionUsed).toBe(0);
  });
});
