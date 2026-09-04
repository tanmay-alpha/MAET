import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceRouter } from "../../api/trpc/routers/workspace";

const workspaceSource = readFileSync(
  join(import.meta.dir, "../../api/trpc/routers/workspace.ts"),
  "utf8",
);
const portfolioSource = readFileSync(
  join(import.meta.dir, "../../api/trpc/routers/portfolio.ts"),
  "utf8",
);

describe("Cloud Workspace Tenant Isolation Test Suite", () => {
  it("exposes only the canonical watchlist API boundary", () => {
    const caller = workspaceRouter.createCaller({
      userId: crypto.randomUUID(),
      email: "workspace-contract@example.com",
      role: "user",
    });

    expect(caller.updateWatchlistItemNote).toBeFunction();
    expect(workspaceSource).toContain("onConflictDoNothing");
    expect(workspaceSource).not.toContain("matchCount: 0");
    expect(portfolioSource).not.toMatch(/\b(getWatchlist|addToWatchlist|removeFromWatchlist)\b/u);
  });

  it("enforces tenant ownership through real router and PostgreSQL operations", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping workspace PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const { applyMigrations } = await import("../../scripts/apply-migrations");
    const { getSqlClient } = await import("../../data/drizzle/client");
    await applyMigrations();

    const sql = getSqlClient();
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const callerA = workspaceRouter.createCaller({
      userId: userA,
      email: `workspace-a-${userA}@example.com`,
      role: "user",
    });
    const callerB = workspaceRouter.createCaller({
      userId: userB,
      email: `workspace-b-${userB}@example.com`,
      role: "user",
    });

    const expectNotFound = async (operation: Promise<unknown>) => {
      try {
        await operation;
        throw new Error("Expected operation to be denied");
      } catch (error) {
        expect(error).toMatchObject({ code: "NOT_FOUND" });
      }
    };

    try {
      await sql`
        INSERT INTO auth.users (id) VALUES (${userA}), (${userB})
        ON CONFLICT DO NOTHING
      `;
      await sql`
        INSERT INTO public.users (id, email)
        VALUES
          (${userA}, ${`workspace-a-${userA}@example.com`}),
          (${userB}, ${`workspace-b-${userB}@example.com`})
      `;

      const watchlistA = await callerA.createWatchlist({ name: "  User A List  " });
      const watchlistB = await callerB.createWatchlist({ name: "User B List" });
      const itemA = await callerA.addWatchlistItem({
        watchlistId: watchlistA.id,
        symbol: "  reliance  ",
        exchange: "NSE",
      });
      const duplicateItemA = await callerA.addWatchlistItem({
        watchlistId: watchlistA.id,
        symbol: "RELIANCE",
        exchange: "NSE",
      });
      const screenerA = await callerA.saveScreener({
        name: "User A Screen",
        criteria: { schemaVersion: 1 },
      });
      await callerB.saveScreener({
        name: "User B Screen",
        criteria: { schemaVersion: 1 },
      });

      expect(watchlistA.name).toBe("User A List");
      expect(itemA.symbol).toBe("RELIANCE");
      expect(duplicateItemA.id).toBe(itemA.id);

      await expectNotFound(callerB.addWatchlistItem({
        watchlistId: watchlistA.id,
        symbol: "TCS",
        exchange: "NSE",
      }));
      await expectNotFound(callerB.renameWatchlist({
        watchlistId: watchlistA.id,
        name: "Taken Over",
      }));
      await expectNotFound(callerB.deleteWatchlist({ watchlistId: watchlistA.id }));
      await expectNotFound(callerB.removeWatchlistItem({ itemId: itemA.id }));
      await expectNotFound(callerB.updateWatchlistItemNote({
        itemId: itemA.id,
        note: "not mine",
      }));
      await expectNotFound(callerB.updateScreener({
        screenerId: screenerA.id,
        name: "Taken Over",
      }));
      await expectNotFound(callerB.deleteScreener({ screenerId: screenerA.id }));

      const listsA = await callerA.listWatchlists({ limit: 1 });
      expect(listsA.items).toHaveLength(1);
      expect(listsA.items[0]?.id).toBe(watchlistA.id);
      expect(listsA.items[0]?.items).toHaveLength(1);
      expect(listsA.items[0]?.items[0]?.id).toBe(itemA.id);
      expect(listsA.items.some((watchlist) => watchlist.id === watchlistB.id)).toBe(false);

      const screenersA = await callerA.listSavedScreeners();
      expect(screenersA).toHaveLength(1);
      expect(screenersA[0]?.id).toBe(screenerA.id);
    } finally {
      await sql`DELETE FROM public.users WHERE id IN (${userA}, ${userB})`;
      await sql`DELETE FROM auth.users WHERE id IN (${userA}, ${userB})`;
    }
  });
});
