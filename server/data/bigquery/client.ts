import { BigQuery } from "@google-cloud/bigquery";

let bqInstance: BigQuery | null = null;

/**
 * Initialize and retrieve the BigQuery client instance.
 * Resolves authentication credentials automatically from Google Application Default Credentials (ADC).
 */
export function getBigQuery(): BigQuery {
  if (!bqInstance) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || "tradeved-screener";
    bqInstance = new BigQuery({
      projectId,
    });
  }
  return bqInstance;
}

/**
 * Stream insert rows into the specified BigQuery table under the 'tradeved_warehouse' dataset.
 *
 * @param tableId - Target table ID (e.g. 'historical_candles', 'ratio_snapshots')
 * @param rows - Array of objects containing field-value pairs matching the target table schema.
 */
export async function streamToBigQuery(tableId: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) return;
  const bq = getBigQuery();
  const datasetId = "tradeved_warehouse";
  
  try {
    console.log(`Streaming ${rows.length} rows to BigQuery table: ${datasetId}.${tableId}...`);
    await bq.dataset(datasetId).table(tableId).insert(rows);
    console.log(`Successfully ingested ${rows.length} rows to BigQuery table ${tableId}`);
  } catch (error: any) {
    console.error(`Error ingesting data into BigQuery table ${tableId}:`, error);
    if (error.errors) {
      console.error("BigQuery insertion errors:", JSON.stringify(error.errors, null, 2));
    }
    throw error;
  }
}
export async function testConnection(): Promise<boolean> {
  try {
    const bq = getBigQuery();
    const [datasets] = await bq.getDatasets();
    return datasets.length > 0;
  } catch (error) {
    console.error("Failed to connect to BigQuery:", error);
    return false;
  }
}
