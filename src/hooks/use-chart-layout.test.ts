import { describe, expect, test } from "bun:test";
import {
  deleteStoredNamedLayout,
  parseNamedLayouts,
  readStoredNamedLayouts,
  saveStoredNamedLayout,
  writeStoredLayout,
  type SavedLayout,
} from "./use-chart-layout";
import { MemoryStorage } from "@/test-utils/memory-storage";

const indicators = { volume: true, ma: false, rsi: true, macd: false };
const chartState = { zoom: 1.2, panOffset: -10, drawings: [] };

function savedLayout(name: string): SavedLayout {
  return { name, timeframe: "5m", chartType: "candles", indicators, savedAt: "2026-11-05T00:00:00.000Z" };
}

// Two tabs share one localStorage but each keeps its own in-memory hook state.
describe("named layout persistence across tabs", () => {
  test("a save in one tab keeps layouts saved by another tab", () => {
    const storage = new MemoryStorage();
    saveStoredNamedLayout(storage, "RELIANCE", savedLayout("from-tab-a"));
    saveStoredNamedLayout(storage, "RELIANCE", savedLayout("from-tab-b"));

    expect(Object.keys(readStoredNamedLayouts(storage, "RELIANCE")).sort()).toEqual(["from-tab-a", "from-tab-b"]);
  });

  test("a delete in one tab removes only that layout", () => {
    const storage = new MemoryStorage();
    saveStoredNamedLayout(storage, "RELIANCE", savedLayout("keep"));
    saveStoredNamedLayout(storage, "RELIANCE", savedLayout("drop"));

    expect(Object.keys(deleteStoredNamedLayout(storage, "RELIANCE", "drop"))).toEqual(["keep"]);
    expect(Object.keys(readStoredNamedLayouts(storage, "RELIANCE"))).toEqual(["keep"]);
  });

  test("persisting the current layout never touches named layouts", () => {
    const storage = new MemoryStorage();
    saveStoredNamedLayout(storage, "RELIANCE", savedLayout("swing"));
    writeStoredLayout(storage, "RELIANCE", {
      timeframe: "1D",
      chartType: "line",
      indicators,
      drawingTool: null,
    });

    expect(Object.keys(readStoredNamedLayouts(storage, "RELIANCE"))).toEqual(["swing"]);
  });
});

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
