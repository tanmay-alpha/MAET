import { CREATED_STRATEGY_ID } from "./support/data";
import { test, expect, signIn } from "./support/fixtures";
import { API_ORIGIN } from "./support/mock-api";

test("strategy lab: creating from a template opens /strategies/:id", async ({ page, api }) => {
  await signIn(page);
  await page.goto("/strategies");
  await expect(page.getByRole("heading", { name: "Strategy Lab" })).toBeVisible();

  // The library is server-rendered and fetches nothing, so no data signals hydration:
  // repeat the click until React handles it and the detail panel opens.
  await expect(async () => {
    await page.getByRole("button", { name: /SMA Crossover/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "SMA Crossover" })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass();

  const createRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url() === `${API_ORIGIN}/api/trpc/strategyDefinitions.create`,
  );
  await page.getByRole("button", { name: "Use this template", exact: true }).click();
  const body = (await createRequest).postDataJSON();
  expect(body).toMatchObject({
    name: "SMA Crossover",
    definition: {
      name: "SMA Crossover",
      direction: "LONG_ONLY",
      timeframe: "1d",
      universe: { type: "SINGLE_SYMBOL", symbolOrId: "RELIANCE" },
      entry: { kind: "GROUP" },
      exit: { kind: "GROUP" },
      risk: { maximumOpenPositions: 1, allowPyramiding: false },
      execution: { feeModel: "VOLUME_AWARE", initialCapital: 100_000 },
    },
  });

  // Public URL, not the internal "/_app/..." route id that used to 404.
  await expect(page).toHaveURL((url) => url.pathname === `/strategies/${CREATED_STRATEGY_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "SMA Crossover" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rules", exact: true })).toBeVisible();
  await expect(page.getByText("Strategy not found")).toHaveCount(0);

  const getCalls = api.trpcCalls("strategyDefinitions.get");
  expect(getCalls.length).toBeGreaterThan(0);
  expect(JSON.parse(getCalls[0].url.searchParams.get("input") ?? "{}")).toEqual({
    strategyId: CREATED_STRATEGY_ID,
  });
});
