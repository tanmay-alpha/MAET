import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import { validateDailyBars, type OHLCVRow } from "./validators/schema-validator";
import { toOHLCVRows } from "./sources/yahoo-history";
import { getCandleInsertValues, getIngestionRunCompletionMetadata } from "./writers/supabase-writer";
import { runDailyPipeline, type DailyPipelineDependencies } from "./pipelines/daily-pipeline";

const NOW = new Date("2026-11-19T12:00:00.000Z");

function bar(overrides: Partial<OHLCVRow> = {}): OHLCVRow {
  return {
    symbol: "RELIANCE",
    ts: "2026-11-18T03:45:00.000Z",
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    volume: 1_000,
    source_tag: "yahoo",
    ...overrides,
  };
}

describe("validateDailyBars", () => {
  it("accepts a consistent bar unchanged", () => {
    const result = validateDailyBars([bar()], NOW);
    expect(result.valid).toEqual([bar()]);
    expect(result.rejected).toEqual([]);
  });

  it("accepts flat bars where open, high, low and close coincide", () => {
    const flat = bar({ open: 50, high: 50, low: 50, close: 50, volume: 0 });
    expect(validateDailyBars([flat], NOW).valid).toEqual([flat]);
  });

  const invalid: Array<[string, Partial<OHLCVRow> | Record<string, unknown>, string]> = [
    ["high below low", { high: 90, low: 95, open: 92, close: 93 }, "high must be >= low"],
    ["open above high", { open: 111 }, "open must lie within [low, high]"],
    ["open below low", { open: 94 }, "open must lie within [low, high]"],
    ["close above high", { close: 111 }, "close must lie within [low, high]"],
    ["close below low", { close: 94 }, "close must lie within [low, high]"],
    ["zero low", { low: 0, open: 1, close: 1 }, "low must be positive"],
    ["negative open", { open: -1, low: -1 }, "open must be positive"],
    ["negative volume", { volume: -5 }, "volume"],
    ["fractional volume", { volume: 10.5 }, "volume"],
    ["non-finite close", { close: Number.NaN }, "close"],
    ["date-only ts", { ts: "2026-11-18" }, "ts"],
    ["future ts", { ts: "2026-11-20T03:45:00.000Z" }, "ts out of valid range"],
    ["pre-1990 ts", { ts: "1989-12-29T03:45:00.000Z" }, "ts out of valid range"],
  ];

  for (const [name, overrides, reason] of invalid) {
    it(`rejects a bar with ${name}`, () => {
      const result = validateDailyBars([{ ...bar(), ...overrides }], NOW);
      expect(result.valid).toEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.reasons.join("; ")).toContain(reason);
    });
  }

  it("counts each rejected bar once however many rules it breaks", () => {
    const rows = [
      bar(),
      bar({ ts: "2026-11-17T03:45:00.000Z", open: -1, high: -2, low: 5, close: 0 }),
      { not: "a bar" },
      bar({ ts: "2026-11-16T03:45:00.000Z" }),
    ];
    const result = validateDailyBars(rows, NOW);
    expect(result.valid.map((row) => row.ts)).toEqual(["2026-11-18T03:45:00.000Z", "2026-11-16T03:45:00.000Z"]);
    expect(result.rejected.map((rejection) => rejection.row)).toEqual([rows[1], rows[2]]);
  });

  it("rejects a second bar for the same symbol and instant", () => {
    const first = bar();
    const second = bar({ ts: "2026-11-18T09:15:00.000+05:30", close: 106 });
    const result = validateDailyBars([first, second], NOW);
    expect(result.valid).toEqual([first]);
    expect(result.rejected).toEqual([{ row: second, reasons: ["duplicate bar for symbol and ts"] }]);
  });
});

describe("daily bar mapping", () => {
  const providerCandle: Candle = {
    symbol: "RELIANCE",
    tf: "1d",
    ts: "2026-11-18T03:45:00.000Z",
    open: 1400.5,
    high: 1420.25,
    low: 1395,
    close: 1410.75,
    volume: 5_432_100,
  };

  it("keeps the provider bar timestamp and the canonical symbol", () => {
    expect(toOHLCVRows("NIFTY50", [{ ...providerCandle, symbol: "^NSEI" }])).toEqual([{
      symbol: "NIFTY50",
      ts: "2026-11-18T03:45:00.000Z",
      open: 1400.5,
      high: 1420.25,
      low: 1395,
      close: 1410.75,
      volume: 5_432_100,
      source_tag: "yahoo",
    }]);
  });

  it("maps validated rows to the candles key the chart reader queries", () => {
    const [row] = toOHLCVRows("RELIANCE", [providerCandle]);
    expect(getCandleInsertValues([row!], "1d")).toEqual([{
      symbol: "RELIANCE",
      timeframe: "1d",
      ts: new Date("2026-11-18T03:45:00.000Z"),
      open: "1400.5",
      high: "1420.25",
      low: "1395",
      close: "1410.75",
      volume: 5_432_100,
      source: "yahoo",
    }]);
  });
});

describe("runDailyPipeline", () => {
  function harness(rows: unknown[]) {
    const written: OHLCVRow[][] = [];
    const completions: Array<Parameters<DailyPipelineDependencies["completeRun"]>[0]> = [];
    const deps: DailyPipelineDependencies = {
      fetchHistory: async ({ symbols }) => symbols.map((symbol) => ({ symbol, rows: rows as OHLCVRow[] })),
      writeBars: async (validRows) => {
        written.push(validRows);
        return {
          supabase: { inserted: validRows.length, failed: 0, durationMs: 0 },
          bigquery: { rowsStreamed: 0, failed: 0, durationMs: 0 },
          totalDurationMs: 0,
        };
      },
      startRun: async () => {},
      completeRun: async (input) => { completions.push(input); },
      pushToDLQ: async () => {},
    };
    return { deps, written, completions };
  }

  it("writes only valid bars and records rejected bars on the run", async () => {
    const good = bar({ ts: "2020-01-02T03:45:00.000Z" });
    const bad = bar({ ts: "2020-01-03T03:45:00.000Z", high: 90 });
    const { deps, written, completions } = harness([good, bad]);

    const result = await runDailyPipeline({ symbols: ["RELIANCE"] }, deps);

    expect(written).toEqual([[good]]);
    expect(result).toMatchObject({ status: "success", recordsInserted: 1, validationRejected: 1, symbolsSucceeded: 1 });
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ status: "success", recordsInserted: 1, recordsRejected: 1 });
  });

  it("fails a symbol whose every bar is rejected without writing anything", async () => {
    const { deps, written, completions } = harness([bar({ ts: "2020-01-02T03:45:00.000Z", volume: -1 })]);

    const result = await runDailyPipeline({ symbols: ["RELIANCE"] }, deps);

    expect(written).toEqual([]);
    expect(result).toMatchObject({ status: "failed", symbolsFailed: 1, validationRejected: 1 });
    expect(completions[0]).toMatchObject({ status: "failed", recordsRejected: 1 });
  });
});

describe("ingestion run completion metadata", () => {
  const startedAt = new Date("2026-11-19T00:00:00.000Z");

  it("records the rejected count when the pipeline reports one", () => {
    expect(getIngestionRunCompletionMetadata({ runId: "r", status: "success", recordsRejected: 0, startedAt }))
      .toEqual({ recordsRejected: 0 });
  });

  it("leaves metadata untouched for pipelines that do not validate records", () => {
    expect(getIngestionRunCompletionMetadata({ runId: "r", status: "success", startedAt })).toEqual({});
  });
});
