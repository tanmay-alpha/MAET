import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { headlinesFor, SAMPLE_HEADLINES } from "./-news";

describe("News samples", () => {
  it("carry a topic only: no outlet, time, figure or sentiment", () => {
    for (const headline of SAMPLE_HEADLINES) {
      expect(Object.keys(headline).sort()).toEqual(["category", "id", "summary", "symbols", "title"]);
      expect(`${headline.title} ${headline.summary}`).not.toMatch(/\d+\s*(?:min|mins|minutes?|hours?|hrs?|days?)\s+ago|\d+(?:\.\d+)?\s*%/i);
    }
  });

  it("filter by category and show every sample under All", () => {
    expect(headlinesFor("all")).toEqual(SAMPLE_HEADLINES);
    expect(headlinesFor("economy").map((h) => h.id)).toEqual(["policy"]);
    expect(headlinesFor("markets").every((h) => h.category === "markets")).toBe(true);
  });
});

describe("Database integrity", () => {
  it("Migration 0009_financial_integrity_rls.sql contains explicit RLS policies", () => {
    const migrationPath = resolve(__dirname, "../../server/db/migrations/0009_financial_integrity_rls.sql");
    const content = readFileSync(migrationPath, "utf-8");
    expect(content).toContain("ENABLE ROW LEVEL SECURITY");
    expect(content).toContain("paper_accounts_own_select");
    expect(content).toContain("auth.uid() = user_id");
    expect(content).toContain("service_role");
  });
});
