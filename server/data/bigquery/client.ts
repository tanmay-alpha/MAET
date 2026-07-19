import { BigQuery } from "@google-cloud/bigquery";
import { TRPCError } from "@trpc/server";

let bqInstance: BigQuery | null = null;

function getProjectId(): string {
  const projectId = process.env.BIGQUERY_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error(
      "BigQuery project ID is not configured. Set BIGQUERY_PROJECT or GOOGLE_CLOUD_PROJECT in your .env file."
    );
  }
  return projectId;
}

function getDatasetId(): string {
  const datasetId = process.env.BIGQUERY_DATASET;
  if (!datasetId) {
    throw new Error(
      "BigQuery dataset ID is not configured. Set BIGQUERY_DATASET in your .env file."
    );
  }
  return datasetId;
}

/**
 * Initialize and retrieve the BigQuery client instance.
 * Authentication is resolved from Google Application Default Credentials (ADC),
 * or from the GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account JSON file.
 *
 * Required env vars:
 *   BIGQUERY_PROJECT  — GCP project ID
 *   BIGQUERY_DATASET  — BigQuery dataset name
 *
 * Optional:
 *   GOOGLE_APPLICATION_CREDENTIALS — path to a service account key JSON file
 */
export function getBigQuery(): BigQuery {
  if (!bqInstance) {
    bqInstance = new BigQuery({
      projectId: getProjectId(),
    });
  }
  return bqInstance;
}

/**
 * Stream insert rows into the specified BigQuery table.
 * The dataset is determined by the BIGQUERY_DATASET environment variable.
 *
 * @param tableId - Target table ID (e.g. 'historical_candles', 'ratio_snapshots')
 * @param rows    - Array of objects whose fields match the target table schema.
 */
export async function streamToBigQuery(
  tableId: string,
  rows: Record<string, any>[]
): Promise<void> {
  if (rows.length === 0) return;

  const bq = getBigQuery();
  const datasetId = getDatasetId();

  try {
    console.log(`[BigQuery] Streaming ${rows.length} rows → ${datasetId}.${tableId}`);
    await bq.dataset(datasetId).table(tableId).insert(rows);
    console.log(`[BigQuery] ✓ ${rows.length} rows ingested into ${datasetId}.${tableId}`);
  } catch (error: any) {
    console.error(`[BigQuery] ✗ Failed to ingest into ${datasetId}.${tableId}:`, error?.message ?? error);
    if (error?.errors) {
      console.error("[BigQuery] Row errors:", JSON.stringify(error.errors, null, 2));
    }
    throw error;
  }
}

/**
 * Run a read-only SQL query against BigQuery and return the rows.
 * Only SELECT statements are permitted. DDL/DML is rejected.
 */
const FORBIDDEN_KEYWORDS = /\b(CREATE|DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|MERGE)\b/i;

export async function queryBigQuery<T = Record<string, any>>(sql: string): Promise<T[]> {
  const trimmed = sql.trim().replace(/^--.*$/gm, "").trim();
  if (!trimmed.toUpperCase().startsWith("SELECT")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only SELECT queries are permitted via queryBigQuery",
    });
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Query contains forbidden keywords (DDL/DML not allowed)",
    });
  }

  console.log("[BigQuery][AUDIT] " + new Date().toISOString() + " - " + sql.slice(0, 500));

  const bq = getBigQuery();
  const startTime = Date.now();
  try {
    const [rows] = await Promise.race([
      bq.query({ query: sql, useLegacySql: false }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("BigQuery query timed out after 120s")), 120_000)
      ),
    ]);
    console.log("[BigQuery] Query completed in " + (Date.now() - startTime) + "ms");
    return rows as T[];
  } catch (err) {
    console.error("[BigQuery] Query failed:", err);
    throw err;
  }
}

/**
 * Test connectivity by listing datasets in the configured project.
 */
export async function testBigQueryConnection(): Promise<boolean> {
  try {
    const bq = getBigQuery();
    const [datasets] = await bq.getDatasets();
    console.log(`[BigQuery] Connected. Found ${datasets.length} dataset(s) in project.`);
    return datasets.length >= 0;
  } catch (error: any) {
    console.error("[BigQuery] Connection test failed:", error?.message ?? error);
    return false;
  }
}
