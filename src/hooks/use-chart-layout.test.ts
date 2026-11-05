import { describe, expect, test } from "bun:test";
import { parseNamedLayouts } from "./use-chart-layout";

const indicators = { volume: true, ma: false, rsi: true, macd: false };
const chartState = { zoom: 1.2, panOffset: -10, drawings: [] };

describe("parseNamedLayouts", () => {
  test("keeps layouts saved by the chart page before it used the shared format", () => {
    const layouts = parseNamedLayouts({
      swing: { chartState, selectedTF: "1D", selectedChartType: "line", indicators: { volume: true, ma: false, rsi: true } },
    });

    expect(layouts.swing).toMatchObject({
      name: "swing",
      chartState,
      timeframe: "1D",
      chartType: "line",
      indicators,
    });
  });

  test("drops entries that are not layouts", () => {
    const current = { name: "intraday", timeframe: "5m", chartType: "candles", indicators, savedAt: "2026-11-05T00:00:00.000Z" };
    expect(parseNamedLayouts({ intraday: current, broken: { timeframe: 5 } })).toEqual({ intraday: current });
    expect(parseNamedLayouts("not an object")).toEqual({});
  });
});
