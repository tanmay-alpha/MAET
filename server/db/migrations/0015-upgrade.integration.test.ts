import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("Migration 0015 Additive Upgrade Integration Test Suite", () => {
  const sqlPath = join(process.cwd(), "server/db/migrations/0015_tradingview_research_workspace.sql");
  const sqlContent = readFileSync(sqlPath, "utf8");

  test("1. Migration 0015 contains zero DROP TABLE statements", () => {
    expect(sqlContent.toUpperCase()).not.toContain("DROP TABLE");
  });

  test("2. Migration 0015 contains zero CASCADE data loss statements", () => {
    const lines = sqlContent.split("\n");
    const dropCascadeLines = lines.filter((l) => l.toUpperCase().includes("DROP") && l.toUpperCase().includes("CASCADE"));
    expect(dropCascadeLines.length).toBe(0);
  });

  test("3. Migration 0015 uses IF NOT EXISTS for additive tables", () => {
    expect(sqlContent).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sqlContent).toContain("chart_workspaces");
    expect(sqlContent).toContain("chart_panes");
    expect(sqlContent).toContain("chart_drawings");
    expect(sqlContent).toContain("indicator_templates");
    expect(sqlContent).toContain("trade_theses");
    expect(sqlContent).toContain("thesis_signals");
    expect(sqlContent).toContain("thesis_snapshots");
    expect(sqlContent).toContain("thesis_order_links");
    expect(sqlContent).toContain("trade_reviews");
  });
});
