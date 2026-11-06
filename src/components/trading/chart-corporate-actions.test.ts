import { describe, expect, test } from "bun:test";
import type { CorporateActionEvent } from "@shared/types";
import { corporateActionTooltip, describeCorporateAction, placeCorporateActions } from "./chart-corporate-actions";
import { formatIstCrosshairTime } from "./chart-time";

const dividend = (exDate: string, amount = 24, splitAdjusted = false): CorporateActionEvent => ({
  kind: "dividend",
  exDate,
  amount,
  currency: "INR",
  splitAdjusted,
});
const split = (exDate: string, numerator: number, denominator: number): CorporateActionEvent => ({
  kind: "split",
  exDate,
  numerator,
  denominator,
});

/** NSE session opens at 09:15 IST = 03:45 UTC. */
const sessionOpen = (date: string) => Date.parse(`${date}T03:45:00.000Z`);

describe("corporate action text", () => {
  test("dividend tooltip names amount, ex-date and source", () => {
    expect(corporateActionTooltip(dividend("2025-08-12"))).toBe("Dividend ₹24.00 · ex-date 12 Aug 2025 · Yahoo Finance");
    expect(corporateActionTooltip(dividend("2024-08-19", 5, true))).toBe(
      "Dividend ₹5.00 (split-adjusted) · ex-date 19 Aug 2024 · Yahoo Finance",
    );
  });

  test("a 2:1 split is also shown as the 1:1 bonus it may have been", () => {
    expect(describeCorporateAction(split("2024-10-28", 2, 1))).toEqual({ label: "Split/bonus", detail: "2 for 1 · 1:1 as bonus" });
    expect(describeCorporateAction(split("2016-07-01", 3, 2)).detail).toBe("3 for 2 · 1:2 as bonus");
    expect(corporateActionTooltip(split("2024-10-28", 2, 1))).toBe("Split/bonus 2 for 1 · ex-date 28 Oct 2024 · Yahoo Finance");
  });

  test("a consolidation is a reverse split, never a bonus", () => {
    expect(describeCorporateAction(split("2023-01-02", 1, 10))).toEqual({ label: "Reverse split", detail: "1 for 10" });
  });
});

describe("placeCorporateActions", () => {
  const dailyBars = ["2025-08-11", "2025-08-12", "2025-08-13", "2025-08-14"].map(sessionOpen);

  test("puts an event on the daily bar of its ex-date and groups same-day events", () => {
    const placed = placeCorporateActions(dailyBars, [split("2025-08-13", 2, 1), dividend("2025-08-13"), dividend("2025-08-11")]);
    expect(placed).toEqual([
      { time: dailyBars[0] / 1000, events: [dividend("2025-08-11")] },
      { time: dailyBars[2] / 1000, events: [split("2025-08-13", 2, 1), dividend("2025-08-13")] },
    ]);
    expect(placed.map(({ time }) => formatIstCrosshairTime(time, false))).toEqual(["11 Aug '25", "13 Aug '25"]);
  });

  test("drops events outside the bars", () => {
    expect(placeCorporateActions(dailyBars, [dividend("2025-08-08"), dividend("2025-08-20")])).toEqual([]);
  });

  test("puts an event on the weekly bar whose week contains it", () => {
    const weeklyBars = ["2024-10-21", "2024-10-28", "2024-11-04"].map(sessionOpen);
    expect(placeCorporateActions(weeklyBars, [dividend("2024-10-30"), dividend("2024-11-08")])).toEqual([
      { time: weeklyBars[1] / 1000, events: [dividend("2024-10-30")] },
      { time: weeklyBars[2] / 1000, events: [dividend("2024-11-08")] },
    ]);
  });

  test("puts an event on the first intraday bar of its ex-date", () => {
    const fiveMinute = [0, 1, 2]
      .flatMap((i) => [sessionOpen("2025-08-13") + i * 300_000, sessionOpen("2025-08-14") + i * 300_000])
      .sort((a, b) => a - b);
    expect(placeCorporateActions(fiveMinute, [dividend("2025-08-14"), dividend("2025-08-12")])).toEqual([
      { time: sessionOpen("2025-08-14") / 1000, events: [dividend("2025-08-14")] },
    ]);
    // The chart labels that bar with the ex-date and its 09:15 IST open.
    expect(formatIstCrosshairTime(sessionOpen("2025-08-14") / 1000, true)).toBe("14 Aug '25 09:15");
  });

  // NSE was shut on Friday 15 Aug 2025 (Independence Day): the first session trading ex is Monday 18 Aug.
  test("an ex-date on a holiday or weekend goes on the next session's bar, never the one before", () => {
    const bars = ["2025-08-13", "2025-08-14", "2025-08-18", "2025-08-19"].map(sessionOpen);
    const placed = placeCorporateActions(bars, [dividend("2025-08-15"), dividend("2025-08-16"), split("2025-08-17", 2, 1)]);
    expect(placed).toEqual([
      { time: bars[2] / 1000, events: [dividend("2025-08-15"), dividend("2025-08-16"), split("2025-08-17", 2, 1)] },
    ]);

    const fiveMinute = ["2025-08-14", "2025-08-18"].flatMap((day) => [0, 1].map((i) => sessionOpen(day) + i * 300_000));
    expect(placeCorporateActions(fiveMinute, [dividend("2025-08-15")])).toEqual([
      { time: sessionOpen("2025-08-18") / 1000, events: [dividend("2025-08-15")] },
    ]);
  });

  test("a holiday ex-date before the first bar or after the last is dropped", () => {
    const bars = ["2025-08-18", "2025-08-19"].map(sessionOpen);
    expect(placeCorporateActions(bars, [dividend("2025-08-15"), dividend("2025-08-23")])).toEqual([]);
  });
});
