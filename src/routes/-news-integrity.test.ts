import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Phase 0: Mock News & Database Integrity Static Assertions", () => {
  it("1. News route contains explicit DEMO / FICTIONAL CONTENT banner", () => {
    const newsPath = resolve(__dirname, "../../src/routes/_app.news.tsx");
    const content = readFileSync(newsPath, "utf-8");
    expect(content).toContain("DEMO / FICTIONAL CONTENT");
    expect(content).toContain("News Feed (UI Demo)");
    expect(content).not.toContain("Date.now() -");
  });

  it("2. Migration 0009_financial_integrity_rls.sql contains explicit RLS policies", () => {
    const migrationPath = resolve(__dirname, "../../server/db/migrations/0009_financial_integrity_rls.sql");
    const content = readFileSync(migrationPath, "utf-8");
    expect(content).toContain("ENABLE ROW LEVEL SECURITY");
    expect(content).toContain("paper_accounts_own_select");
    expect(content).toContain("auth.uid() = user_id");
    expect(content).toContain("service_role");
  });
});
