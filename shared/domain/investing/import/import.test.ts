import { describe, expect, it } from "bun:test";
import { analyseImport, cashFlowReturn, type ImportAnalysis } from "./analyse";
import { CsvStreamParser, parseCsv, toCsv } from "./csv";
import { financialYearStart, ltcgEligibleFrom, parseTradeDate } from "./dates";
import { detectFormat, guessMapping } from "./normalize";
import { SAMPLE_TRADEBOOK_CSV } from "./sample";

const ZERODHA_HEADER = "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time";
const GROWW_HEADER = "Stock name,Symbol,ISIN,Type,Quantity,Value,Exchange,Exchange Order Id,Execution date and time,Order status";

function analyseText(text: string): ImportAnalysis {
  const [header, ...rows] = parseCsv(text);
  const format = detectFormat(header!.cells);
  if (!format) throw new Error("format not detected");
  return analyseImport(format, header!.cells, rows);
}

/** A minimal Zerodha tradebook: each entry is [symbol, date, side, quantity, price]. */
function zerodha(trades: Array<[string, string, string, number, number]>): string {
  const lines = trades.map(([symbol, date, side, quantity, price], index) =>
    `${symbol},INE000000000,${date},NSE,EQ,EQ,${side},false,${quantity},${price},${index + 1},${index + 1},${date}T10:00:0${index % 10}`);
  return [ZERODHA_HEADER, ...lines].join("\n");
}

describe("broker format detection", () => {
  it("recognises a Zerodha Console tradebook header", () => {
    expect(detectFormat(ZERODHA_HEADER.split(","))).toBe("zerodha");
  });

  it("recognises a Groww order history header regardless of case and spacing", () => {
    expect(detectFormat(GROWW_HEADER.toUpperCase().split(",").map((cell) => ` ${cell} `))).toBe("groww");
  });

  it("falls back to generic mapping for anything else, guessing the obvious columns", () => {
    const headers = ["Trade Date", "Ticker", "Action", "Qty", "Rate"];
    expect(detectFormat(headers)).toBeNull();
    expect(guessMapping(headers)).toEqual({ date: 0, symbol: 1, side: 2, quantity: 3, price: 4, tradeId: -1 });
  });
});

describe("CSV parsing", () => {
  it("handles a BOM, CRLF line endings, quoted commas and escaped quotes", () => {
    const rows = parseCsv('\uFEFFa,b,c\r\n"1,234.50","say ""hi""",x\r\n\r\nlast,,\r\n');
    expect(rows).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["1,234.50", 'say "hi"', "x"] },
      { line: 4, cells: ["last", "", ""] },
    ]);
  });

  it("gives the same rows when the input arrives in arbitrary chunks", () => {
    const text = 'h1,h2\r\n"multi\r\nline","q""uote"\r\nplain,2';
    const parser = new CsvStreamParser();
    for (const character of text) parser.push(character);
    expect(parser.end()).toEqual(parseCsv(text));
    expect(parseCsv(text)[1]).toEqual({ line: 2, cells: ["multi\r\nline", 'q"uote'] });
  });

  it("rejects an unterminated quoted field instead of guessing", () => {
    expect(() => parseCsv('a,b\n"open,1')).toThrow(/line 2/);
  });

  it("round-trips exported cells that need quoting", () => {
    const csv = toCsv([["symbol", "note"], ["INFY", 'a, "b"'], ["TCS", 12.5]]);
    expect(parseCsv(csv).map((row) => row.cells)).toEqual([["symbol", "note"], ["INFY", 'a, "b"'], ["TCS", "12.5"]]);
  });

  it("exports cells that a spreadsheet would run as formulas as plain text", () => {
    const csv = toCsv([
      ["=HYPERLINK(\"https://evil.test\",\"x\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1:A2)", "\t=1+1", "\r=1+1"],
    ]);
    expect(parseCsv(csv)[0]!.cells).toEqual([
      "'=HYPERLINK(\"https://evil.test\",\"x\")", "'+cmd|' /C calc'!A0", "'-2+3", "'@SUM(A1:A2)", "'\t=1+1", "'\r=1+1",
    ]);
  });

  it("keeps typed numbers numeric, negative ones included, and neutralises numeric-looking text", () => {
    expect(toCsv([[-21293.75, 0, 12.5, -0.05]])).toBe("-21293.75,0,12.5,-0.05");
    // A string reached toCsv as text (a symbol or note from the file), so it stays text.
    expect(toCsv([["-12.5", "INFY"]])).toBe("'-12.5,INFY");
  });
});

describe("dates", () => {
  it("parses the broker date styles as calendar dates and rejects impossible ones", () => {
    expect(parseTradeDate("2024-09-03T14:55:02")).toEqual({ date: "2024-09-03", time: "14:55:02" });
    expect(parseTradeDate("15-01-2024 02:30 PM")).toEqual({ date: "2024-01-15", time: "14:30:00" });
    expect(parseTradeDate("29/02/2024")).toEqual({ date: "2024-02-29", time: "00:00:00" });
    expect(parseTradeDate("7 Mar 2025, 9:15 am")).toEqual({ date: "2025-03-07", time: "09:15:00" });
    expect(parseTradeDate("2024-02-30")).toBeNull();
    expect(parseTradeDate("2023-02-29")).toBeNull();
    expect(parseTradeDate("12 Foo 2024")).toBeNull();
  });

  it("buckets Indian financial years April to March", () => {
    expect(financialYearStart("2024-03-31")).toBe(2023);
    expect(financialYearStart("2024-04-01")).toBe(2024);
  });

  it("first LTCG-eligible sale date is the day after the twelve-month anniversary", () => {
    expect(ltcgEligibleFrom("2023-03-01")).toBe("2024-03-02");
    expect(ltcgEligibleFrom("2024-02-29")).toBe("2025-03-01");
    expect(ltcgEligibleFrom("2024-12-31")).toBe("2026-01-01");
  });
});

describe("row validation", () => {
  it("accepts, rejects and de-duplicates the sample tradebook with a reason per row", () => {
    const analysis = analyseText(SAMPLE_TRADEBOOK_CSV);
    expect(analysis.counts).toEqual({ parsed: 15, accepted: 9, rejected: 5, duplicates: 1 });
    const reasons = analysis.rows.filter((row) => row.status !== "accepted").map((row) => [row.line, row.reason]);
    expect(reasons).toEqual([
      [6, "Duplicate trade id 2004"],
      [9, "Sell without prior buy: 10 sold, 0 held"],
      [10, "F&O segment excluded"],
      [11, 'Bad date "2024-02-30"'],
      [12, "Zero quantity"],
      [15, 'Unknown side "transfer"'],
    ]);
  });

  it("derives Groww prices from value and excludes orders that did not execute", () => {
    const analysis = analyseText([
      GROWW_HEADER,
      'Infosys Ltd,INFY,INE009A01021,BUY,10,"14,805.00",NSE,11,15-01-2024 10:30 AM,Executed',
      "Infosys Ltd,INFY,INE009A01021,SELL,4,6400,NSE,12,16-01-2024 11:00 AM,Cancelled",
    ].join("\r\n"));
    expect(analysis.rows.map((row) => [row.status, row.reason])).toEqual([["accepted", undefined], ["rejected", 'Order status "Cancelled" excluded']]);
    expect(analysis.holdings).toMatchObject([{ symbol: "INFY", quantity: 10, avgCost: 1480.5 }]);
  });

  it("rejects a sell larger than the quantity held at that time, leaving the holding intact", () => {
    const analysis = analyseText(zerodha([["ABC", "2024-01-01", "buy", 5, 10], ["ABC", "2024-01-02", "sell", 6, 12]]));
    expect(analysis.rows[1]).toMatchObject({ status: "rejected", reason: "Sell without prior buy: 6 sold, 5 held" });
    expect(analysis.trips).toEqual([]);
    expect(analysis.holdings).toMatchObject([{ symbol: "ABC", quantity: 5 }]);
  });

  it("orders by trade date, not file order, before checking holdings", () => {
    const analysis = analyseText(zerodha([["ABC", "2024-01-05", "sell", 5, 12], ["ABC", "2024-01-01", "buy", 5, 10]]));
    expect(analysis.counts.accepted).toBe(2);
    expect(analysis.trips).toMatchObject([{ quantity: 5, gain: 10 }]);
  });
});

describe("FIFO through the shared capital-gains engine", () => {
  it("splits a sale across partial lots and keeps the rest of the later lot open", () => {
    const analysis = analyseText(zerodha([["ABC", "2023-01-10", "buy", 10, 100], ["ABC", "2023-06-10", "buy", 10, 120], ["ABC", "2024-03-01", "sell", 15, 150]]));
    expect(analysis.trips).toMatchObject([
      { quantity: 10, buyDate: "2023-01-10", buyValue: 1000, sellValue: 1500, gain: 500, term: "LTCG", financialYearStart: 2023 },
      { quantity: 5, buyDate: "2023-06-10", buyValue: 600, sellValue: 750, gain: 150, term: "STCG" },
    ]);
    expect(analysis.holdings).toEqual([{ symbol: "ABC", quantity: 5, invested: 600, avgCost: 120, lots: 1, oldestLotDate: "2023-06-10", ltcgEligibleFrom: "2024-06-11", fullyLtcgEligibleFrom: "2024-06-11" }]);
  });

  it("classifies same-day round trips as intraday", () => {
    const analysis = analyseText(zerodha([["ABC", "2024-08-01", "buy", 30, 100], ["ABC", "2024-08-01", "sell", 10, 101]]));
    expect(analysis.trips).toMatchObject([{ quantity: 10, gain: 10, term: "Intraday" }]);
  });

  it("treats exactly twelve months across a leap year (366 days) as STCG and the next day as LTCG", () => {
    const exact = analyseText(zerodha([["ABC", "2023-03-01", "buy", 1, 100], ["ABC", "2024-03-01", "sell", 1, 110]]));
    const nextDay = analyseText(zerodha([["ABC", "2023-03-01", "buy", 1, 100], ["ABC", "2024-03-02", "sell", 1, 110]]));
    expect(exact.trips[0]!.term).toBe("STCG");
    expect(nextDay.trips[0]!.term).toBe("LTCG");
  });
});

describe("financial years", () => {
  it("lists exit FYs newest first and reuses the shared tax report per FY", () => {
    const analysis = analyseText(SAMPLE_TRADEBOOK_CSV);
    expect(analysis.financialYears).toEqual([2025, 2024]);
    expect(analysis.trips.reduce((total, trip) => total + trip.gain, 0)).toBeCloseTo(3657.5, 6);
    const fy2024 = analysis.taxReport(2024);
    expect(fy2024.grossLtcg).toBeCloseTo(5200, 6);
    expect(fy2024.grossStcg).toBeCloseTo(150 - 2220, 6);
    expect(fy2024.intradayPnl).toBeCloseTo(187.5, 6);
    expect(analysis.taxReport(2025).grossLtcg).toBeCloseTo(340, 6);
  });
});

describe("cash-flow XIRR", () => {
  // 2025 has no leap day, so 365 days is exactly one ACT/365 year: 10% gross.
  it("waits for a price on every holding, then values them on the as-of date", () => {
    const analysis = analyseText(zerodha([["ABC", "2025-01-01", "buy", 100, 100]]));
    expect(cashFlowReturn(analysis, {}, "2026-01-01")).toMatchObject({ missing: ["ABC"], xirr: null });
    const result = cashFlowReturn(analysis, { ABC: 110 }, "2026-01-01");
    expect(result.flows).toEqual([
      { date: "2025-01-01", amount: -10000, label: "Buy ABC" },
      { date: "2026-01-01", amount: 11000, label: "Holdings at current price" },
    ]);
    expect(result.xirr).toBeCloseTo(0.1, 6);
  });

  it("needs no prices once everything is sold", () => {
    const analysis = analyseText(zerodha([["ABC", "2025-01-01", "buy", 10, 100], ["ABC", "2026-01-01", "sell", 10, 110]]));
    const result = cashFlowReturn(analysis, {}, "2026-06-01");
    expect(result.missing).toEqual([]);
    expect(result.xirr).toBeCloseTo(0.1, 6);
  });
});
