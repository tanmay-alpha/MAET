import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, getSqlClient } from "../../data/drizzle/client";
import { companies, corporateActions, deadLetterQueue, ingestionRuns } from "../../db/schema";
import { appRouter } from "../../api/trpc";
import fixture from "../../data/sources/fixtures/yahoo-chart-events-reliance.json";
import { _resetCircuitForTest } from "../../data/sources/yahoo";
import { runDailyProcessor } from "../../workers/daily-processor";
import { buildDataQualityReport, type ResolvedUniverse } from "../data-quality/service";
import { CORPORATE_ACTION_RUN_SOURCE } from "./ingest";
import { loadCorporateActions } from "./repository";

// Real Yahoo events (RELIANCE.NS: 10 dividends, 4 splits) served for two test symbols; a third
// symbol's provider is down. Every call goes through the real Yahoo client, retries included.
const WITH_COMPANY = "TEST_CA_LISTED";
const WITHOUT_COMPANY = "TEST_CA_UNLISTED";
const DOWN = "TEST_CA_DOWN";
const SYMBOLS = [WITH_COMPANY, WITHOUT_COMPANY, DOWN];
const EVENTS = 14;

const admin = appRouter.createCaller({ userId: "00000000-0000-4000-8000-0000000000ca", email: null, role: "admin" });
const universe: ResolvedUniverse = {
  id: "nifty50",
  label: "corporate-actions fixture",
  cap: 50,
  members: [WITH_COMPANY, WITHOUT_COMPANY].map((symbol) => ({ symbol, name: null })),
};

const origFetch = globalThis.fetch;

async function cleanup() {
  await db.delete(corporateActions).where(inArray(corporateActions.symbol, SYMBOLS));
  await db.delete(companies).where(eq(companies.id, WITH_COMPANY));
  await db.delete(ingestionRuns).where(eq(ingestionRuns.source, CORPORATE_ACTION_RUN_SOURCE));
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.source, CORPORATE_ACTION_RUN_SOURCE));
}

const storedRows = () =>
  db.select().from(corporateActions)
    .where(inArray(corporateActions.symbol, SYMBOLS))
    .orderBy(asc(corporateActions.symbol), asc(corporateActions.actionType), asc(corporateActions.exDate));

const gapIds = async () => (await buildDataQualityReport(universe)).pipelineGaps.map((gap) => gap.id);

describe("corporate-action ingestion into Postgres", () => {
  beforeAll(async () => {
    await cleanup();
    // Disposable test database only: the empty-table gap is a whole-table check.
    await db.delete(corporateActions);
    await db.insert(companies).values({ id: WITH_COMPANY, symbol: WITH_COMPANY, name: "Corporate Actions Test Ltd", exchange: "NSE" });
    globalThis.fetch = (async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(`/${DOWN}.NS`)) return new Response("unavailable", { status: 503 });
      return Response.json(fixture);
    }) as unknown as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    _resetCircuitForTest();
    await cleanup();
  });

  it("flags corporate_actions_empty while the table is empty", async () => {
    expect(await gapIds()).toContain("corporate_actions_empty");
  });

  it("gives the same rows when the admin-triggered ingest runs twice", async () => {
    const first = await admin.ingestion.triggerCorporateActions({ symbols: SYMBOLS });
    expect(first).toMatchObject({
      status: "partial",
      symbolsAttempted: 3,
      symbolsSucceeded: 2,
      symbolsFailed: 1,
      recordsInserted: 2 * EVENTS,
      recordsUpdated: 0,
      recordsUnchanged: 0,
    });
    const afterFirst = await storedRows();
    expect(afterFirst).toHaveLength(2 * EVENTS);

    const second = await admin.ingestion.triggerCorporateActions({ symbols: SYMBOLS });
    expect(second).toMatchObject({ status: "partial", recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 2 * EVENTS });
    // Same ids, values and ingested_at: unchanged rows are not rewritten.
    expect(await storedRows()).toEqual(afterFirst);

    const runs = await db.select().from(ingestionRuns)
      .where(eq(ingestionRuns.source, CORPORATE_ACTION_RUN_SOURCE))
      .orderBy(asc(ingestionRuns.startedAt));
    expect(runs.map((run) => [run.batchId, run.dataType, run.status, run.attempted, run.failed, run.inserted])).toEqual([
      [first.runId, "corporate-actions", "partial", 3, 1, 2 * EVENTS],
      [second.runId, "corporate-actions", "partial", 3, 1, 0],
    ]);
    expect(runs[0]!.metadata).toMatchObject({ trigger: "admin", symbols: SYMBOLS });
    expect(runs[0]!.errorSummary).toContain(`${DOWN}: yahoo events 503`);

    const dead = await db.select().from(deadLetterQueue).where(eq(deadLetterQueue.source, CORPORATE_ACTION_RUN_SOURCE));
    expect(dead.map((row) => row.batchId).sort()).toEqual([first.runId, second.runId].sort());
    for (const row of dead) expect(row.payload).toMatchObject({ symbol: DOWN, errorCode: "FETCH_FAILED" });
  });

  it("stores ex-dates at midnight IST, the Yahoo source and the company link when one exists", async () => {
    const [split] = await getSqlClient()<Array<{ ex_date_ist: string; ratio: string; source: string; source_reference: string; company_id: string | null }>>`
      SELECT to_char(ex_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS ex_date_ist,
             ratio_numerator || ':' || ratio_denominator AS ratio, source, source_reference, company_id
      FROM corporate_actions
      WHERE symbol = ${WITH_COMPANY} AND action_type = 'SPLIT'
      ORDER BY ex_date DESC LIMIT 1
    `;
    expect(split).toEqual({ ex_date_ist: "2024-10-28 00:00", ratio: "2:1", source: "yahoo", source_reference: `${WITH_COMPANY}.NS`, company_id: WITH_COMPANY });

    const unlisted = await db.select({ companyId: corporateActions.companyId }).from(corporateActions).where(eq(corporateActions.symbol, WITHOUT_COMPANY));
    expect(unlisted.every((row) => row.companyId === null)).toBe(true);

    expect(await loadCorporateActions(WITH_COMPANY, new Date("2024-10-01T00:00:00Z"), new Date("2024-11-30T00:00:00Z"))).toMatchObject([
      { symbol: WITH_COMPANY, actionType: "SPLIT", exDate: "2024-10-28", ratioNumerator: 2, ratioDenominator: 1, source: "yahoo" },
    ]);
  });

  it("stops the data-quality report flagging corporate_actions_empty and counts actions per symbol", async () => {
    const report = await buildDataQualityReport(universe);
    expect(report.pipelineGaps.map((gap) => gap.id)).not.toContain("corporate_actions_empty");
    const row = report.symbols.find((symbol) => symbol.symbol === WITH_COMPANY)!;
    expect(row.corporateActions).toEqual({ count: EVENTS, latestExDate: "2026-06-05" });
    expect(report.summary.corporateActionsCovered).toBe(2);
  });

  it("runs from the daily processor as its own recorded run, changing nothing already stored", async () => {
    const before = await storedRows();
    const stats = await runDailyProcessor({
      symbols: [WITH_COMPANY],
      syncCompanyMaster: false,
      syncMarketData: false,
      syncFundamentals: false,
      refreshClassifications: false,
      cleanupStaleData: false,
    });
    expect(stats).toMatchObject({ corporateActionsWritten: 0, corporateActionsFailed: [], errors: [] });
    expect(await storedRows()).toEqual(before);
    const [run] = await db.select().from(ingestionRuns).where(and(
      eq(ingestionRuns.source, CORPORATE_ACTION_RUN_SOURCE),
      eq(ingestionRuns.status, "succeeded"),
    ));
    expect(run).toMatchObject({ attempted: 1, failed: 0, inserted: 0, metadata: { trigger: "daily-processor", symbols: [WITH_COMPANY] } });
  });
});
