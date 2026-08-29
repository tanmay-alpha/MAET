import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, getSqlClient } from "../../data/drizzle/client";

const writerModule = await import("./writers/supabase-writer");
const dlqModule = await import("./queue/dead-letter-queue");

type StartRunInput = Parameters<typeof writerModule.startIngestionRun>[0];
type CompleteRunInput = Parameters<typeof writerModule.completeIngestionRun>[0];
type DLQEntryInput = Parameters<typeof dlqModule.pushToDLQ>[0];

const writerContract = writerModule as typeof writerModule & {
  getIngestionRunStartValues: (input: StartRunInput) => Record<string, unknown>;
  getIngestionRunCompletionValues: (
    input: CompleteRunInput,
    completedAt: Date,
  ) => Record<string, unknown>;
};

const dlqContract = dlqModule as typeof dlqModule & {
  getDLQInsertValues: (entry: DLQEntryInput) => Record<string, unknown>;
  getDLQRecord: (row: {
    id: string;
    source: string;
    dataType: string;
    batchId: string | null;
    payload: unknown;
    errorMessage: string;
    retryCount: number;
    lastAttemptedAt: Date;
    resolvedAt: Date | null;
    resolvedBy: string | null;
    resolutionNote: string | null;
    createdAt: Date;
  }) => Record<string, unknown>;
  getRetryAttemptValues: (
    success: boolean,
    errorMessage: string | undefined,
    attemptedAt: Date,
  ) => Record<string, unknown>;
  getDLQStatsFromRows: (rows: Array<{
    source: string;
    total: number;
    pending: number;
    resolved: number;
  }>) => {
    total: number;
    pending: number;
    resolved: number;
    bySource: Record<string, number>;
  };
};

describe("canonical ingestion persistence", () => {
  it("maps a caller run identity to a canonical running ingestion row", () => {
    expect(writerContract.getIngestionRunStartValues({
      runId: "daily-test-001",
      source: "yahoo-history",
      pipeline: "daily",
    })).toEqual({
      batchId: "daily-test-001",
      source: "yahoo-history",
      dataType: "daily",
      operation: "ingest",
      status: "running",
      metadata: {},
    });
  });

  it("maps successful completion counters and timestamps to canonical fields", () => {
    const startedAt = new Date("2026-08-29T10:00:00.000Z");
    const completedAt = new Date("2026-08-29T10:00:10.000Z");
    const completion = writerContract.getIngestionRunCompletionValues({
      runId: "daily-test-001",
      status: "success",
      symbolsAttempted: 10,
      symbolsSucceeded: 8,
      symbolsFailed: 2,
      recordsInserted: 100,
      recordsUpdated: 4,
      startedAt,
    }, completedAt);

    expect(completion).toEqual({
      status: "succeeded",
      attempted: 10,
      failed: 2,
      inserted: 100,
      updated: 4,
      errorSummary: null,
      completedAt,
      durationMs: 10_000,
    });
    expect(completion).not.toHaveProperty("metadata");
    expect(completion).not.toHaveProperty("symbolsSucceeded");
  });

  it("preserves partial and failed completion statuses", () => {
    const completedAt = new Date("2026-08-29T10:00:01.000Z");
    const startedAt = new Date("2026-08-29T10:00:00.000Z");
    for (const status of ["partial", "failed"] as const) {
      expect(writerContract.getIngestionRunCompletionValues({
        runId: `daily-${status}`,
        status,
        startedAt,
      }, completedAt).status).toBe(status);
    }
  });

  it("maps new DLQ writes to canonical fields and structured payload", () => {
    expect(dlqContract.getDLQInsertValues({
      source: "yahoo-history",
      pipeline: "daily",
      batchId: "daily-test-001",
      symbol: "RELIANCE",
      errorCode: "FETCH_FAILED",
      errorMessage: "provider unavailable",
      rawPayload: { status: 503 },
    })).toEqual({
      source: "yahoo-history",
      dataType: "daily",
      batchId: "daily-test-001",
      payload: {
        symbol: "RELIANCE",
        errorCode: "FETCH_FAILED",
        rawPayload: { status: 503 },
      },
      errorMessage: "provider unavailable",
    });
  });

  it("does not fabricate optional DLQ payload context", () => {
    const insertion = dlqContract.getDLQInsertValues({
      source: "yahoo-history",
      pipeline: "daily",
      errorMessage: "provider unavailable",
    });
    expect(insertion.payload).toEqual({});
    expect(insertion).not.toHaveProperty("batchId");

    const historicalRecord = dlqContract.getDLQRecord({
      id: "946cefd0-e142-444d-9346-3a9944b697c8",
      source: "yahoo-history",
      dataType: "daily",
      batchId: null,
      payload: { legacy: true },
      errorMessage: "legacy failure",
      retryCount: 1,
      lastAttemptedAt: new Date("2026-08-28T10:00:00.000Z"),
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      createdAt: new Date("2026-08-28T09:00:00.000Z"),
    });
    expect(historicalRecord.symbol).toBeUndefined();
    expect(historicalRecord.errorCode).toBeUndefined();
    expect(historicalRecord.rawPayload).toEqual({ legacy: true });

    const structuredRecordWithoutRawPayload = dlqContract.getDLQRecord({
      id: "cbfa7da9-bb72-40cb-9228-4c5f3360ea9a",
      source: "yahoo-history",
      dataType: "daily",
      batchId: "daily-test-002",
      payload: { symbol: "RELIANCE", errorCode: "FETCH_FAILED" },
      errorMessage: "new failure",
      retryCount: 0,
      lastAttemptedAt: new Date("2026-08-29T10:00:00.000Z"),
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
    });
    expect(structuredRecordWithoutRawPayload.rawPayload).toBeUndefined();
  });

  it("builds an atomic failed-retry update without resolving the row", () => {
    const attemptedAt = new Date("2026-08-29T10:05:00.000Z");
    const retryUpdate = dlqContract.getRetryAttemptValues(false, "still unavailable", attemptedAt);
    expect(retryUpdate.retryCount).toBeDefined();
    expect(typeof retryUpdate.retryCount).not.toBe("number");
    expect(retryUpdate.lastAttemptedAt).toBe(attemptedAt);
    expect(retryUpdate.errorMessage).toBe("still unavailable");
    expect(retryUpdate).not.toHaveProperty("resolvedAt");
  });

  it("does not overwrite a real DLQ error when a failed retry has no new error", () => {
    const retryUpdate = dlqContract.getRetryAttemptValues(
      false,
      undefined,
      new Date("2026-08-29T10:05:00.000Z"),
    );
    expect(retryUpdate).not.toHaveProperty("errorMessage");
  });

  it("marks a successful retry resolved without fabricating resolution metadata", () => {
    const attemptedAt = new Date("2026-08-29T10:05:00.000Z");
    expect(dlqContract.getRetryAttemptValues(true, undefined, attemptedAt)).toEqual({
      lastAttemptedAt: attemptedAt,
      resolvedAt: attemptedAt,
    });
  });

  it("derives DLQ totals from canonical resolved-at aggregates", () => {
    expect(dlqContract.getDLQStatsFromRows([
      { source: "yahoo-history", total: 5, pending: 3, resolved: 2 },
      { source: "nse-equities", total: 4, pending: 1, resolved: 3 },
    ])).toEqual({
      total: 9,
      pending: 4,
      resolved: 5,
      bySource: {
        "yahoo-history": 5,
        "nse-equities": 4,
      },
    });
  });

  it("does not depend on legacy database column identifiers", () => {
    const writerSource = readFileSync(join(__dirname, "writers", "supabase-writer.ts"), "utf8");
    const dlqSource = readFileSync(join(__dirname, "queue", "dead-letter-queue.ts"), "utf8");

    for (const legacyColumn of [
      "run_id",
      "symbols_attempted",
      "symbols_succeeded",
      "symbols_failed",
      "records_inserted",
      "records_updated",
      "error_message",
    ]) {
      expect(writerSource).not.toContain(legacyColumn);
    }
    for (const legacyColumn of ["error_code", "raw_payload", "max_retries", "next_retry_at"]) {
      expect(dlqSource).not.toContain(legacyColumn);
    }
    expect(dlqSource).not.toMatch(/\bWHERE\s+resolved\b/u);
    expect(dlqSource).not.toMatch(/\bSET\s+resolved\b/u);
    expect(dlqSource).not.toMatch(/GROUP BY\s+source,\s*resolved\b/u);
  });

  it("keeps ingestion observability readers on canonical columns", () => {
    const routerSource = readFileSync(
      join(__dirname, "..", "..", "api", "trpc", "routers", "ingestion.ts"),
      "utf8",
    );
    const healthSource = readFileSync(
      join(__dirname, "..", "..", "routes", "health", "detailed.get.ts"),
      "utf8",
    );

    for (const readerSource of [routerSource, healthSource]) {
      for (const legacyColumn of [
        "symbols_attempted",
        "symbols_succeeded",
        "symbols_failed",
        "records_inserted",
      ]) {
        expect(readerSource).not.toContain(legacyColumn);
      }
      expect(readerSource).not.toMatch(/\bresolved\s*=\s*false\b/u);
      expect(readerSource).toContain("succeeded");
      expect(readerSource).toContain("success");
    }
  });

  it("executes the canonical lifecycle against PostgreSQL when configured", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.warn("TEST_DATABASE_URL not set; skipping ingestion persistence PostgreSQL contract test");
      return;
    }

    const sqlClient = getSqlClient();
    const batchId = `ingestion-contract-${crypto.randomUUID()}`;
    let dlqId: string | undefined;
    const startedAt = new Date(Date.now() - 1_000);

    try {
      await writerModule.startIngestionRun({
        runId: batchId,
        source: "contract-test",
        pipeline: "daily",
        metadata: { contractTest: true },
      });
      const [startedRun] = await sqlClient`
        SELECT batch_id, source, data_type, operation, status
        FROM ingestion_runs
        WHERE batch_id = ${batchId}
      `;
      expect(startedRun).toMatchObject({
        batch_id: batchId,
        source: "contract-test",
        data_type: "daily",
        operation: "ingest",
        status: "running",
      });

      await writerModule.completeIngestionRun({
        runId: batchId,
        status: "success",
        symbolsAttempted: 10,
        symbolsFailed: 2,
        recordsInserted: 100,
        recordsUpdated: 4,
        startedAt,
      });
      const [completedRun] = await sqlClient`
        SELECT status, attempted, failed, inserted, updated, completed_at, duration_ms
        FROM ingestion_runs
        WHERE batch_id = ${batchId}
      `;
      expect(completedRun.status).toBe("succeeded");
      expect(completedRun.attempted).toBe(10);
      expect(completedRun.failed).toBe(2);
      expect(completedRun.inserted).toBe(100);
      expect(completedRun.updated).toBe(4);
      expect(completedRun.completed_at).toBeInstanceOf(Date);
      expect(completedRun.duration_ms).toBeGreaterThanOrEqual(1_000);

      await dlqModule.pushToDLQ({
        source: "contract-test",
        pipeline: "daily",
        batchId,
        symbol: "RELIANCE",
        errorCode: "CONTRACT_TEST_FAILURE",
        errorMessage: "contract test failure",
        rawPayload: { provider: "test" },
      });
      const [dlqRow] = await sqlClient`
        SELECT id, data_type, batch_id, payload, error_message, retry_count,
               last_attempted_at, resolved_at
        FROM dead_letter_queue
        WHERE batch_id = ${batchId}
      `;
      dlqId = dlqRow.id;
      expect(dlqRow.data_type).toBe("daily");
      expect(dlqRow.payload).toEqual({
        symbol: "RELIANCE",
        errorCode: "CONTRACT_TEST_FAILURE",
        rawPayload: { provider: "test" },
      });

      await dlqModule.markRetryAttempt(dlqId, false, "retry failed");
      const [failedRetry] = await sqlClient`
        SELECT retry_count, last_attempted_at, resolved_at, error_message
        FROM dead_letter_queue
        WHERE id = ${dlqId}::uuid
      `;
      expect(failedRetry.retry_count).toBe(1);
      expect(failedRetry.last_attempted_at).toBeInstanceOf(Date);
      expect(failedRetry.resolved_at).toBeNull();
      expect(failedRetry.error_message).toBe("retry failed");

      await dlqModule.markRetryAttempt(dlqId, true);
      const [resolvedRetry] = await sqlClient`
        SELECT resolved_at
        FROM dead_letter_queue
        WHERE id = ${dlqId}::uuid
      `;
      expect(resolvedRetry.resolved_at).toBeInstanceOf(Date);
    } finally {
      await sqlClient`DELETE FROM dead_letter_queue WHERE batch_id = ${batchId}`;
      await sqlClient`DELETE FROM ingestion_runs WHERE batch_id = ${batchId}`;
      await closeDb();
    }
  });
});
