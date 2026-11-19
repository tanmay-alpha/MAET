import { describe, expect, it } from "bun:test";
import type { CorporateActionEvent } from "@shared/types";
import fixture from "../../data/sources/fixtures/yahoo-chart-events-reliance.json";
import { normalizeYahooCorporateActions, type YahooChartEvents } from "../../data/sources/yahoo";
import { integerRatio, istMidnight, mapCorporateActions } from "./mapping";

const result = fixture.chart.result[0]!;
const events = normalizeYahooCorporateActions(result.events as YahooChartEvents, result.meta);
const key = (row: { symbol: string; actionType: string; exDate: Date }) => `${row.symbol}|${row.actionType}|${row.exDate.toISOString()}`;

describe("istMidnight", () => {
  it("stores an IST calendar date as midnight IST, the instant readers format back AT TIME ZONE 'Asia/Kolkata'", () => {
    expect(istMidnight("2024-10-28").toISOString()).toBe("2024-10-27T18:30:00.000Z");
  });
});

describe("integerRatio", () => {
  it("reduces whole and decimal ratios to the smallest integer pair", () => {
    expect(integerRatio(2, 1)).toEqual([2, 1]);
    expect(integerRatio(10, 2)).toEqual([5, 1]);
    expect(integerRatio(1.5, 1)).toEqual([3, 2]);
    expect(integerRatio(1, 10)).toEqual([1, 10]);
  });

  it("refuses ratios four decimals cannot express exactly", () => {
    expect(integerRatio(1 / 3, 1)).toBeNull();
  });
});

describe("mapCorporateActions on RELIANCE's Yahoo history", () => {
  const mapped = mapCorporateActions("RELIANCE", "RELIANCE.NS", events);

  it("keeps every event as one row, nothing rejected", () => {
    expect(mapped.rejected).toEqual([]);
    expect(mapped.rows).toHaveLength(events.length);
    expect(mapped.rows.filter((row) => row.actionType === "SPLIT")).toHaveLength(4);
  });

  it("maps the October 2024 1:1 bonus to a 2:1 SPLIT at midnight IST on its ex-date", () => {
    expect(mapped.rows.find((row) => row.actionType === "SPLIT" && row.exDate.getTime() === istMidnight("2024-10-28").getTime())).toEqual({
      symbol: "RELIANCE",
      source: "yahoo",
      sourceReference: "RELIANCE.NS",
      actionType: "SPLIT",
      exDate: istMidnight("2024-10-28"),
      amount: null,
      ratioNumerator: 2,
      ratioDenominator: 1,
      details: JSON.stringify({ mayBeBonus: true }),
    });
  });

  it("maps dividends with amount, currency and whether Yahoo restated the amount", () => {
    const byDate = (date: string) => mapped.rows.find((row) => row.actionType === "DIVIDEND" && row.exDate.getTime() === istMidnight(date).getTime());
    expect(byDate("2025-08-14")).toMatchObject({
      amount: "5.5",
      currency: "INR",
      ratioNumerator: null,
      ratioDenominator: null,
      details: JSON.stringify({ restatedByProvider: false }),
    });
    // ₹10 paid before the bonus, restated by Yahoo as ₹5.
    expect(byDate("2024-08-19")).toMatchObject({ amount: "5", details: JSON.stringify({ restatedByProvider: true }) });
  });

  it("is idempotent: one row per (symbol, action_type, ex_date), the same rows on every call", () => {
    const keys = mapped.rows.map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(mapCorporateActions("RELIANCE", "RELIANCE.NS", events)).toEqual(mapped);
    // Provider order does not matter.
    expect(mapCorporateActions("RELIANCE", "RELIANCE.NS", [...events].reverse())).toEqual(mapped);
  });
});

describe("mapCorporateActions on colliding events", () => {
  const dividend = (amount: number, currency = "INR"): CorporateActionEvent => ({ kind: "dividend", exDate: "2025-08-14", amount, currency, adjusted: false });

  it("sums two dividends with one ex-date into one row (one cash payment per share)", () => {
    const { rows, rejected } = mapCorporateActions("ITC", "ITC.NS", [dividend(6.5), dividend(1.25)]);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionType: "DIVIDEND", amount: "7.75", details: JSON.stringify({ restatedByProvider: false, components: [6.5, 1.25] }) });
  });

  it("composes two splits on one ex-date", () => {
    const { rows } = mapCorporateActions("X", "X.NS", [
      { kind: "split", exDate: "2020-01-02", numerator: 2, denominator: 1 },
      { kind: "split", exDate: "2020-01-02", numerator: 5, denominator: 1 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionType: "SPLIT", ratioNumerator: 10, ratioDenominator: 1 });
  });

  it("rejects what the table cannot hold instead of guessing", () => {
    const { rows, rejected } = mapCorporateActions("X", "X.NS", [
      dividend(1, "INR"),
      dividend(1, "USD"),
      { kind: "split", exDate: "2021-03-04", numerator: 1, denominator: 3.0000001 },
    ]);
    expect(rows).toEqual([]);
    expect(rejected.map((item) => [item.kind, item.exDate])).toEqual([["dividend", "2025-08-14"], ["split", "2021-03-04"]]);
  });

  it("rounds amounts to the column's four decimals", () => {
    const { rows } = mapCorporateActions("BHARTIARTL", "BHARTIARTL.NS", [{ kind: "dividend", exDate: "2020-08-06", amount: 1.963142, currency: "INR", adjusted: true }]);
    expect(rows[0]!.amount).toBe("1.9631");
  });
});
