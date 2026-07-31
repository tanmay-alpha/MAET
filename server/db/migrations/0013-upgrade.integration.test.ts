import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

describe("Migration 0013 Additive Upgrade Integration Test Suite", () => {
  const migrationsDir = join(__dirname);
  const migration0013Path = join(migrationsDir, "0013_advanced_product_features.sql");
  const migration0013Sql = readFileSync(migration0013Path, "utf-8");

  it("1. Migration 0013 contains zero DROP TABLE statements", () => {
    expect(migration0013Sql).not.toMatch(/DROP TABLE IF EXISTS public\.ingestion_runs/i);
    expect(migration0013Sql).not.toMatch(/DROP TABLE IF EXISTS public\.dead_letter_queue/i);
    expect(migration0013Sql).not.toMatch(/DROP TABLE/i);
  });

  it("2. Migration 0013 contains zero CASCADE data loss statements", () => {
    expect(migration0013Sql).not.toMatch(/DROP TABLE.*CASCADE/i);
    expect(migration0013Sql).not.toMatch(/TRUNCATE/i);
  });

  it("3. Migration 0013 uses IF NOT EXISTS for additive columns and tables", () => {
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.user_watchlists");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.watchlist_items");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.saved_screener_definitions");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.saved_screener_runs");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.alerts");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.alert_events");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.user_notifications");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.portfolio_snapshots");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.research_notes");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.feature_preferences");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.ingestion_runs");
    expect(migration0013Sql).toContain("CREATE TABLE IF NOT EXISTS public.dead_letter_queue");
    expect(migration0013Sql).toContain("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS batch_id text;");
    expect(migration0013Sql).toContain("ALTER TABLE public.dead_letter_queue ADD COLUMN IF NOT EXISTS data_type text;");
  });

  it("4. Migration 0013 preserves backward compatibility and data mapping", () => {
    expect(migration0013Sql).toContain("UPDATE public.ingestion_runs SET batch_id = COALESCE(batch_id, run_id)");
    expect(migration0013Sql).toContain("UPDATE public.dead_letter_queue SET data_type = COALESCE(data_type, pipeline)");
  });
});
