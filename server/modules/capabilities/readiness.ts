/**
 * Capability Readiness Evaluator.
 *
 * Evaluates feature readiness per capability based on:
 *   - explicit environment feature flags (FEATURE_*)
 *   - database schema table/column availability (fail-closed if table missing)
 *   - user authentication & admin role status
 *   - external provider availability
 */

import { getSqlClient } from "../../data/drizzle/client";
import type { CapabilityKey, CapabilityState } from "./contracts";

export interface ReadinessContext {
  userId?: string | null;
  isAdmin?: boolean;
  userRole?: string;
  schemaMap?: Record<string, boolean>;
}

export function isEnvFlagEnabled(envVarName: string): boolean {
  const val = process.env[envVarName];
  if (!val) return false;
  return val.toLowerCase() === "true" || val === "1";
}

let cachedTableMap: { map: Record<string, boolean>; timestamp: number } | null = null;

export async function checkDatabaseTablesExist(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cachedTableMap && now - cachedTableMap.timestamp < 30000) {
    return cachedTableMap.map;
  }

  const tableMap: Record<string, boolean> = {};
  const requiredTables = [
    "user_watchlists",
    "watchlist_items",
    "saved_screener_definitions",
    "saved_screener_runs",
    "alerts",
    "alert_events",
    "user_notifications",
    "portfolio_snapshots",
    "research_notes",
    "feature_preferences",
    "ingestion_runs",
    "dead_letter_queue",
    "saved_comparisons",
    "companies",
    "fundamentals",
    "quote_snapshots",
    "candles",
    "backtest_runs",
    "source_audit",
    "anomaly_flags",
  ];

  try {
    const client = getSqlClient();
    if (client) {
      const rows = await client`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      `;
      const existingTables = new Set(rows.map((r: any) => r.tablename));
      for (const table of requiredTables) {
        tableMap[table] = existingTables.has(table);
      }
    } else {
      for (const table of requiredTables) {
        tableMap[table] = false;
      }
    }
  } catch {
    for (const table of requiredTables) {
      tableMap[table] = false;
    }
  }

  cachedTableMap = { map: tableMap, timestamp: now };
  return tableMap;
}

export async function evaluateReadiness(ctx: ReadinessContext): Promise<CapabilityState[]> {
  const tables = ctx.schemaMap ?? (await checkDatabaseTablesExist());
  const hasAuth = typeof ctx.userId === "string" && ctx.userId.length > 0;
  const isAdmin = ctx.isAdmin === true || ctx.userRole === "admin";

  const results: CapabilityState[] = [];

  // 1. cloudWorkspace
  const cwFlag = isEnvFlagEnabled("FEATURE_CLOUD_WORKSPACE");
  const cwSchema = Boolean(tables["user_watchlists"] && tables["watchlist_items"]);
  results.push({
    key: "cloudWorkspace",
    available: cwFlag && cwSchema && hasAuth,
    reason: !cwFlag
      ? "FEATURE_CLOUD_WORKSPACE flag disabled"
      : !cwSchema
      ? "Cloud workspace schema missing (requires migration 0013)"
      : !hasAuth
      ? "Cloud workspace requires authentication"
      : undefined,
  });

  // 2. alertEngine
  const aeFlag = isEnvFlagEnabled("FEATURE_ALERT_ENGINE");
  const aeSchema = Boolean(tables["alerts"] && tables["alert_events"] && tables["user_notifications"]);
  results.push({
    key: "alertEngine",
    available: aeFlag && aeSchema && hasAuth,
    reason: !aeFlag
      ? "FEATURE_ALERT_ENGINE flag disabled"
      : !aeSchema
      ? "Alert engine schema missing (requires migration 0013)"
      : !hasAuth
      ? "Alert engine requires authentication"
      : undefined,
  });

  // 3. scorecard
  const scFlag = isEnvFlagEnabled("FEATURE_SCORECARD");
  const scSchema = Boolean(tables["companies"] && tables["fundamentals"]);
  results.push({
    key: "scorecard",
    available: scFlag && scSchema,
    reason: !scFlag
      ? "FEATURE_SCORECARD flag disabled"
      : !scSchema
      ? "Scorecard requires company fundamentals schema"
      : undefined,
  });

  // 4. peerComparison
  const pcFlag = isEnvFlagEnabled("FEATURE_PEER_COMPARISON");
  const pcSchema = Boolean(tables["companies"] && tables["fundamentals"]);
  results.push({
    key: "peerComparison",
    available: pcFlag && pcSchema,
    reason: !pcFlag
      ? "FEATURE_PEER_COMPARISON flag disabled"
      : !pcSchema
      ? "Peer comparison requires company sector schema"
      : undefined,
  });

  // 5. dynamicHeatmap
  const dhFlag = isEnvFlagEnabled("FEATURE_DYNAMIC_HEATMAP");
  const dhSchema = Boolean(tables["companies"] && tables["quote_snapshots"]);
  results.push({
    key: "dynamicHeatmap",
    available: dhFlag && dhSchema,
    reason: !dhFlag
      ? "FEATURE_DYNAMIC_HEATMAP flag disabled"
      : !dhSchema
      ? "Dynamic heatmap requires quote snapshots schema"
      : undefined,
  });

  // 6. naturalLanguageScreener
  const nlFlag = isEnvFlagEnabled("FEATURE_NL_SCREENER");
  results.push({
    key: "naturalLanguageScreener",
    available: nlFlag,
    reason: !nlFlag ? "FEATURE_NL_SCREENER flag disabled" : undefined,
  });

  // 7. backtestV2
  const btFlag = isEnvFlagEnabled("FEATURE_BACKTEST_V2");
  const btSchema = Boolean(tables["backtest_runs"] && tables["candles"]);
  results.push({
    key: "backtestV2",
    available: btFlag && btSchema,
    reason: !btFlag
      ? "FEATURE_BACKTEST_V2 flag disabled"
      : !btSchema
      ? "Backtest V2 requires candle history schema"
      : undefined,
  });

  // 8. dataQuality
  const dqFlag = isEnvFlagEnabled("FEATURE_DATA_QUALITY");
  const dqSchema = Boolean(tables["ingestion_runs"] && tables["dead_letter_queue"] && tables["source_audit"] && tables["anomaly_flags"]);
  results.push({
    key: "dataQuality",
    available: dqFlag && dqSchema && hasAuth && isAdmin,
    reason: !dqFlag
      ? "FEATURE_DATA_QUALITY flag disabled"
      : !dqSchema
      ? "Data quality centre requires ingestion audit schema (migration 0013)"
      : !hasAuth
      ? "Data quality centre requires sign in"
      : !isAdmin
      ? "Data quality centre requires admin role"
      : undefined,
  });

  // 9. portfolioAnalytics (Always unavailable in production per requirement)
  results.push({
    key: "portfolioAnalytics",
    available: false,
    reason: "Portfolio analytics unavailable in pre-production",
  });

  // 10. researchTimeline (Always unavailable in production per requirement)
  results.push({
    key: "researchTimeline",
    available: false,
    reason: "Research timeline unavailable in pre-production",
  });

  // 11. derivatives
  results.push({
    key: "derivatives",
    available: false,
    reason: "No verified derivatives provider connected",
  });

  // 12. liveNews
  results.push({
    key: "liveNews",
    available: false,
    reason: "No verified news provider connected",
  });

  return results;
}
