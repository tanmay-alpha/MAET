import { describe, expect, it } from "bun:test";
import { evaluateReadiness } from "./readiness";

describe("Capabilities Readiness Evaluator Test Suite", () => {
  it("1. Fails closed when feature flags are false (default state)", async () => {
    const caps = await evaluateReadiness({
      userId: "test-user-id",
      schemaMap: {
        user_watchlists: true,
        watchlist_items: true,
        alerts: true,
        alert_events: true,
        user_notifications: true,
        companies: true,
        fundamentals: true,
        quote_snapshots: true,
        candles: true,
        backtest_runs: true,
        ingestion_runs: true,
        dead_letter_queue: true,
        source_audit: true,
        anomaly_flags: true,
      },
    });

    for (const cap of caps) {
      expect(cap.available).toBe(false);
    }
  });

  it("2. Fails closed when database tables are missing even if flag is enabled", async () => {
    process.env.FEATURE_CLOUD_WORKSPACE = "true";
    try {
      const caps = await evaluateReadiness({
        userId: "test-user-id",
        schemaMap: {
          user_watchlists: false,
          watchlist_items: false,
        },
      });

      const cw = caps.find((c) => c.key === "cloudWorkspace");
      expect(cw?.available).toBe(false);
      expect(cw?.reason).toContain("migration 0013");
    } finally {
      delete process.env.FEATURE_CLOUD_WORKSPACE;
    }
  });

  it("3. Enables cloudWorkspace when flag is enabled AND schema is ready AND user is signed in", async () => {
    process.env.FEATURE_CLOUD_WORKSPACE = "true";
    try {
      const caps = await evaluateReadiness({
        userId: "user-123",
        schemaMap: {
          user_watchlists: true,
          watchlist_items: true,
        },
      });

      const cw = caps.find((c) => c.key === "cloudWorkspace");
      expect(cw?.available).toBe(true);
    } finally {
      delete process.env.FEATURE_CLOUD_WORKSPACE;
    }
  });

  it("4. dataQuality requires admin role", async () => {
    process.env.FEATURE_DATA_QUALITY = "true";
    try {
      const nonAdminCaps = await evaluateReadiness({
        userId: "user-regular",
        role: "user",
        schemaMap: {
          ingestion_runs: true,
          dead_letter_queue: true,
          source_audit: true,
          anomaly_flags: true,
        },
      });
      const dqNonAdmin = nonAdminCaps.find((c) => c.key === "dataQuality");
      expect(dqNonAdmin?.available).toBe(false);
      expect(dqNonAdmin?.reason).toContain("admin");

      const adminCaps = await evaluateReadiness({
        userId: "user-admin",
        role: "admin",
        schemaMap: {
          ingestion_runs: true,
          dead_letter_queue: true,
          source_audit: true,
          anomaly_flags: true,
        },
      });
      const dqAdmin = adminCaps.find((c) => c.key === "dataQuality");
      expect(dqAdmin?.available).toBe(true);
    } finally {
      delete process.env.FEATURE_DATA_QUALITY;
    }
  });

  it("5. portfolioAnalytics is available to signed-in users once the 0027 snapshot table exists", async () => {
    const find = async (userId: string | null, tables: Record<string, boolean>) =>
      (await evaluateReadiness({ userId, schemaMap: tables })).find((c) => c.key === "portfolioAnalytics");
    const migrated = { paper_portfolio_snapshots: true, "paper_portfolio_snapshots.snapshot_date": true };

    expect(await find("user-1", migrated)).toMatchObject({ available: true });
    // The 0008 table has the same name but not the 0027 columns: code needing 0027 would fail.
    const before0027 = await find("user-1", { paper_portfolio_snapshots: true });
    expect(before0027?.available).toBe(false);
    expect(before0027?.reason).toContain("migration 0027");
    // The never-written 0013 table does not count either.
    expect((await find("user-1", { portfolio_snapshots: true }))?.available).toBe(false);
    const signedOut = await find(null, migrated);
    expect(signedOut?.available).toBe(false);
    expect(signedOut?.reason).toContain("sign in");
  });
});
