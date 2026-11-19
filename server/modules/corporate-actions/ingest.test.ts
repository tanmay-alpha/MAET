import { describe, expect, it } from "bun:test";
import type { CorporateActionEvent } from "@shared/types";
import { UpstreamDegradedError } from "@shared/types";
import fixture from "../../data/sources/fixtures/yahoo-chart-events-reliance.json";
import { normalizeYahooCorporateActions, type YahooChartEvents } from "../../data/sources/yahoo";
import {
  CORPORATE_ACTION_PIPELINE,
  CORPORATE_ACTION_RUN_SOURCE,
  runCorporateActionIngestion,
  TRACKED_CORPORATE_ACTION_SYMBOLS,
  type CorporateActionIngestionDeps,
} from "./ingest";
import type { CorporateActionRow } from "./mapping";

const reliance = normalizeYahooCorporateActions(
  fixture.chart.result[0]!.events as YahooChartEvents,
  fixture.chart.result[0]!.meta,
);

/** In-memory corporate_actions with the repository's upsert semantics. */
function harness(eventsByTicker: Record<string, CorporateActionEvent[] | Error>) {
  const table = new Map<string, CorporateActionRow>();
  const calls = { startRun: [] as unknown[], completeRun: [] as Array<Record<string, unknown>>, dlq: [] as Array<Record<string, unknown>>, fetched: [] as string[] };
  const deps: CorporateActionIngestionDeps = {
    fetchEvents: async (ticker) => {
      calls.fetched.push(ticker);
      const events = eventsByTicker[ticker];
      if (events instanceof Error) throw events;
      return events ?? [];
    },
    loadCompanyIds: async (symbols) => new Set(symbols.filter((symbol) => symbol === "RELIANCE")),
    upsertRows: async (rows) => {
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const id = `${row.symbol}|${row.actionType}|${row.exDate.toISOString()}`;
        const existing = table.get(id);
        if (!existing) inserted++;
        else if (JSON.stringify(existing) !== JSON.stringify(row)) updated++;
        else continue;
        table.set(id, row);
      }
      return { inserted, updated, unchanged: rows.length - inserted - updated };
    },
    startRun: async (opts) => void calls.startRun.push(opts),
    completeRun: async (opts) => void calls.completeRun.push(opts as unknown as Record<string, unknown>),
    pushToDLQ: async (entry) => void calls.dlq.push(entry as unknown as Record<string, unknown>),
    now: () => new Date("2026-11-19T13:00:00.000Z"),
  };
  return { deps, table, calls };
}

describe("runCorporateActionIngestion", () => {
  it("defaults to the bundled Nifty 50 list", () => {
    expect(TRACKED_CORPORATE_ACTION_SYMBOLS).toHaveLength(50);
    expect(TRACKED_CORPORATE_ACTION_SYMBOLS).toContain("RELIANCE");
  });

  it("is idempotent: a second run over the same events changes no rows", async () => {
    const { deps, table } = harness({ "RELIANCE.NS": reliance });
    const first = await runCorporateActionIngestion({ symbols: ["RELIANCE"], trigger: "admin" }, deps);
    const afterFirst = structuredClone([...table.entries()]);
    const second = await runCorporateActionIngestion({ symbols: ["reliance"], trigger: "admin" }, deps);

    expect(first).toMatchObject({ status: "success", symbolsSucceeded: 1, eventsFetched: reliance.length, recordsInserted: reliance.length, recordsUpdated: 0 });
    expect(second).toMatchObject({ status: "success", recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: reliance.length });
    expect([...table.entries()]).toEqual(afterFirst);
    expect([...table.values()].every((row) => row.companyId === "RELIANCE" && row.source === "yahoo")).toBe(true);
  });

  it("updates only the rows whose provider values changed", async () => {
    const provider: Record<string, CorporateActionEvent[]> = { "RELIANCE.NS": reliance };
    const { deps, table } = harness(provider);
    await runCorporateActionIngestion({ symbols: ["RELIANCE"], trigger: "admin" }, deps);
    provider["RELIANCE.NS"] = reliance.map((event) => event.kind === "dividend" && event.exDate === "2025-08-14" ? { ...event, amount: 6 } : event);
    const rerun = await runCorporateActionIngestion({ symbols: ["RELIANCE"], trigger: "admin" }, deps);
    expect(rerun).toMatchObject({ recordsInserted: 0, recordsUpdated: 1, recordsUnchanged: reliance.length - 1 });
    expect(table.size).toBe(reliance.length);
  });

  it("records the run in ingestion_runs and dead-letters symbols that still fail after the client's retries", async () => {
    const { deps, calls } = harness({
      "RELIANCE.NS": reliance,
      "TCS.NS": new UpstreamDegradedError("yahoo events 429 for TCS.NS"),
    });
    const result = await runCorporateActionIngestion({ symbols: ["RELIANCE", "TCS"], trigger: "daily-processor" }, deps);

    expect(result).toMatchObject({ status: "partial", symbolsAttempted: 2, symbolsSucceeded: 1, symbolsFailed: 1 });
    expect(calls.startRun).toEqual([{
      runId: result.runId,
      source: CORPORATE_ACTION_RUN_SOURCE,
      pipeline: CORPORATE_ACTION_PIPELINE,
      metadata: { trigger: "daily-processor", symbols: ["RELIANCE", "TCS"] },
    }]);
    expect(calls.completeRun).toEqual([expect.objectContaining({
      runId: result.runId,
      status: "partial",
      symbolsAttempted: 2,
      symbolsSucceeded: 1,
      symbolsFailed: 1,
      recordsInserted: reliance.length,
      errorMessage: "TCS: yahoo events 429 for TCS.NS",
    })]);
    expect(calls.dlq).toEqual([{
      source: CORPORATE_ACTION_RUN_SOURCE,
      pipeline: CORPORATE_ACTION_PIPELINE,
      batchId: result.runId,
      symbol: "TCS",
      errorCode: "FETCH_FAILED",
      errorMessage: "yahoo events 429 for TCS.NS",
    }]);
  });

  it("marks the run failed when no symbol succeeds", async () => {
    const { deps, calls } = harness({ "TCS.NS": new Error("boom") });
    const result = await runCorporateActionIngestion({ symbols: ["TCS"], trigger: "admin" }, deps);
    expect(result.status).toBe("failed");
    expect(calls.completeRun[0]).toMatchObject({ status: "failed" });
    expect(calls.dlq[0]).toMatchObject({ errorCode: "FETCH_FAILED" });
  });

  it("writes nothing on a dry run", async () => {
    const { deps, table, calls } = harness({ "RELIANCE.NS": reliance });
    const result = await runCorporateActionIngestion({ symbols: ["RELIANCE"], trigger: "admin", dryRun: true }, deps);
    expect(result).toMatchObject({ status: "success", eventsFetched: reliance.length, recordsInserted: 0 });
    expect(table.size).toBe(0);
    expect(calls.startRun).toEqual([]);
    expect(calls.completeRun).toEqual([]);
  });
});
