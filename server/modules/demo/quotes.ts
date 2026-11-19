import type { Tick } from "@shared/types";
import { getSqlClient } from "../../data/drizzle/client";
import { isDemoMode } from "./mode";
import { DEMO_DATA_SOURCE } from "./universe";

/** Demo prices come only from explicitly synthetic seeded rows, never a market provider. */
export async function loadDemoQuotes(symbols: string[]): Promise<Map<string, Tick>> {
  if (!isDemoMode() || symbols.length === 0) return new Map();
  const sql = getSqlClient();
  const rows = await sql<{
    company_id: string; price: string; volume: number; change_pct: string | null; as_of: Date;
  }[]>`
    SELECT DISTINCT ON (q.company_id) q.company_id, q.price, q.volume, q.change_pct, q.as_of
    FROM quote_snapshots q
    JOIN companies c ON c.id = q.company_id
    WHERE q.company_id IN ${sql(symbols)} AND q.source = 'simulated' AND c.data_source = ${DEMO_DATA_SOURCE}
    ORDER BY q.company_id, q.as_of DESC`;
  return new Map(rows.map((row) => [row.company_id, {
    exchange: "NSE", symbol: row.company_id, price: Number(row.price), volume: Number(row.volume),
    changePct: row.change_pct === null ? undefined : Number(row.change_pct),
    ts: new Date(row.as_of).toISOString(), source: "simulated", quality: "synthetic",
  }]));
}
