import { describe, expect, test } from "bun:test";
import { mapFillsToTradeMarkers, snapTradeMarkersToBars } from "./chart-trade-markers";
import { formatIstCrosshairTime } from "./chart-time";

/** NSE session open, 09:15 IST, in UTC seconds. */
const sessionOpen = (date: string) => Date.parse(`${date}T03:45:00Z`) / 1000;

const fill = (id: string, executedAt: string) =>
  mapFillsToTradeMarkers([{ id, side: "BUY", price: 1320, quantity: 1, executedAt }])[0];

describe("snapTradeMarkersToBars at the edges of the bars", () => {
  // Production RELIANCE 1d bars on 2026-11-07 ended at the 5 Nov session: Yahoo had not closed 6 Nov's bar yet.
  const daily = ["2026-11-03", "2026-11-04", "2026-11-05"].map(sessionOpen);

  test("a fill on a session the daily bars do not include yet is not drawn on the previous day", () => {
    const snapped = snapTradeMarkersToBars([fill("today", "2026-11-06T10:05:00+05:30")], daily);
    expect(snapped).toEqual([]);
  });

  test("a fill later on the last bar's day stays on that bar", () => {
    const snapped = snapTradeMarkersToBars([fill("late", "2026-11-05T15:20:00+05:30")], daily);
    expect(snapped.map((marker) => formatIstCrosshairTime(marker.time, false))).toEqual(["05 Nov '26"]);
  });

  test("a fill after the last intraday bar waits for its bar", () => {
    const oneMinute = [0, 1, 2].map((m) => sessionOpen("2026-11-06") + m * 60);
    const snapped = snapTradeMarkersToBars(
      [fill("in", "2026-11-06T09:17:40+05:30"), fill("after", "2026-11-06T09:21:00+05:30")],
      oneMinute,
    );
    expect(snapped.map((marker) => [marker.id, formatIstCrosshairTime(marker.time, true)])).toEqual([
      ["in", "06 Nov '26 09:17"],
    ]);
  });

  test("a fill before the first bar is dropped", () => {
    expect(snapTradeMarkersToBars([fill("old", "2026-11-02T11:00:00+05:30")], daily)).toEqual([]);
  });

  test("a single bar keeps fills from its own day only", () => {
    const one = [sessionOpen("2026-11-05")];
    const snapped = snapTradeMarkersToBars(
      [fill("same", "2026-11-05T14:00:00+05:30"), fill("next", "2026-11-06T09:30:00+05:30")],
      one,
    );
    expect(snapped.map((marker) => marker.id)).toEqual(["same"]);
  });
});
