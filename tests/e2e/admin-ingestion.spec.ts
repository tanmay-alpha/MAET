import { test, expect, signIn } from "./support/fixtures";
import type { MockApi } from "./support/mock-api";
import type { ReliabilityReport } from "../../server/modules/data-quality/contracts";

const UNAVAILABLE = { available: false, reason: "not configured" } as const;
const RELIABILITY: ReliabilityReport = {
  asOf: "2026-11-05T10:00:00.000Z",
  health: UNAVAILABLE,
  strategyJobs: UNAVAILABLE,
  ingestion: UNAVAILABLE,
  deadLetterQueue: UNAVAILABLE,
  dailyProcessor: UNAVAILABLE,
};

function asAdmin(api: MockApi) {
  api.onQuery("dataQuality.getReliability", () => RELIABILITY);
  api.onQuery("dataQuality.getOverview", () => ({ recentBatches: [] }));
}

test("admin data status: an admin runs both ingestion pipelines and sees each run row", async ({ page, api }) => {
  await signIn(page);
  asAdmin(api);
  api.onMutation("ingestion.triggerRun", (input) => {
    expect(input).toEqual({ source: "yahoo-history", symbols: ["RELIANCE", "INFY"] });
    return {
      runId: "daily-2026-11-05T10-00-00-000Z",
      status: "completed",
      symbols: ["RELIANCE", "INFY"],
      result: {
        runId: "daily-2026-11-05T10-00-00-000Z",
        status: "success",
        symbolsAttempted: 2,
        symbolsSucceeded: 2,
        symbolsFailed: 0,
        recordsInserted: 490,
        validationRejected: 0,
        dlqPushed: 0,
        durationMs: 4200,
      },
    };
  });
  api.onMutation("ingestion.triggerCorporateActions", () => ({
    runId: "corporate-actions-2026-11-05",
    status: "partial",
    symbolsAttempted: 50,
    symbolsSucceeded: 49,
    symbolsFailed: 1,
    failures: [{ symbol: "TATAMOTORS", error: "404" }],
    eventsFetched: 812,
    recordsInserted: 37,
    recordsUpdated: 0,
    recordsUnchanged: 775,
    recordsRejected: 0,
    durationMs: 61000,
  }));
  api.failProcedure("ingestion.triggerCorporateActions", { code: "CONFLICT", message: "A corporate-actions ingestion is already running." });

  await page.goto("/admin/data-quality");
  const manual = page.getByRole("region", { name: "Manual ingestion" });
  await expect(manual).toBeVisible();

  // Daily: confirm step, then the run row the mutation reported.
  await manual.getByLabel("Symbols (up to 50)").fill("reliance, INFY reliance");
  await manual.getByRole("button", { name: "Run daily ingestion" }).click();
  await expect(manual.getByText("Fetch daily bars for 2 symbols?")).toBeVisible();
  await manual.getByRole("button", { name: "Cancel" }).click();
  expect(api.trpcCalls("ingestion.triggerRun")).toHaveLength(0);
  await manual.getByRole("button", { name: "Run daily ingestion" }).click();
  await manual.getByRole("button", { name: "Confirm" }).click();
  await expect(manual.getByText("Run daily ingestion finished: success.")).toBeVisible();
  const row = manual.getByTestId("ingestion-run-row");
  await expect(row).toContainText("daily-2026-11-05T10-00-00-000Z");
  await expect(row).toContainText("2 / 0");
  await expect(row).toContainText("490");
  await expect(row).toContainText("4.2 s");

  // Corporate actions: an error is shown, then a retry succeeds and shows its run row.
  await manual.getByRole("button", { name: "Run corporate actions ingestion" }).click();
  await manual.getByRole("button", { name: "Confirm" }).click();
  await expect(manual.getByRole("alert")).toHaveText("Run corporate actions ingestion failed: A corporate-actions ingestion is already running.");

  api.failProcedure("ingestion.triggerCorporateActions", null);
  const release = Promise.withResolvers<void>();
  await page.route("**/api/trpc/ingestion.triggerCorporateActions", async (route) => {
    await release.promise;
    await route.fallback();
  });
  await manual.getByRole("button", { name: "Run corporate actions ingestion" }).click();
  await manual.getByRole("button", { name: "Confirm" }).click();
  await expect(manual.getByText("Running…")).toBeVisible();
  release.resolve();
  await expect(manual.getByText("Run corporate actions ingestion finished: partial.")).toBeVisible();
  await expect(manual.getByTestId("ingestion-run-row").last()).toContainText("corporate-actions-2026-11-05");
  await expect(manual.getByTestId("ingestion-run-row").last()).toContainText("49 / 1");
});

test("admin data status: a signed-in non-admin sees no ingestion buttons", async ({ page, api }) => {
  await signIn(page);
  asAdmin(api);
  api.failProcedure("dataQuality.getReliability", { code: "FORBIDDEN", message: "Admin access required" });
  api.failProcedure("dataQuality.getOverview", { code: "FORBIDDEN", message: "Admin access required" });

  await page.goto("/admin/data-quality");
  await expect(page.getByText("Reliability details are visible to admin accounts only.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Manual ingestion" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Run (daily|corporate actions) ingestion/ })).toHaveCount(0);
});
