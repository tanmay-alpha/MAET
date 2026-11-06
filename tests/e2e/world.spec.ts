import { test, expect } from "./support/fixtures";

// Both projects exercise the same behaviour; mobile uses the exact design viewport.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 390, height: 844 });
});

test("world: public panels render, source timestamps and years remain visible, feed selection works", async ({
  page,
  api,
}) => {
  await page.goto("/world");
  await expect(page.getByRole("heading", { name: "World Monitor", exact: true })).toBeVisible();
  for (const title of [
    "Global markets",
    "World map",
    "Event feed",
    "Market exposure",
    "Macro snapshot",
  ]) {
    await expect(page.getByRole("region", { name: title, exact: true })).toBeVisible();
  }
  const feed = page.getByRole("region", { name: "Event feed", exact: true });
  const quake = feed.getByRole("button", { name: /offshore Japan/ });
  await quake.click();
  await expect(quake).toHaveAttribute("aria-pressed", "true");
  await expect(feed.getByText("Not mapped")).toBeVisible();
  await expect(page.getByRole("region", { name: "Market exposure", exact: true })).toContainText(
    "Rule-based exposure hints, not predictions.",
  );
  const exposure = page.getByRole("region", { name: "Market exposure", exact: true });
  await expect(exposure.getByRole("link", { name: "ADANIPORTS", exact: true })).toBeVisible();
  await expect(exposure).toContainText(
    "This route connects Indian maritime trade with European markets",
  );
  const macro = page.getByRole("region", { name: "Macro snapshot", exact: true });
  await expect(macro.getByRole("row", { name: /India/ })).toContainText("6.50%");
  await expect(macro.getByRole("row", { name: /India/ })).toContainText("2024");
  await expect(macro).toContainText("World Bank · updated 10:30 IST");
  await feed
    .getByRole("group", { name: "Feed categories" })
    .getByRole("button", { name: "Earthquakes", exact: true })
    .click();
  await expect(quake).toHaveCount(0);
  expect(
    api.requests
      .filter((request) => request.url.pathname.startsWith("/api/world/"))
      .map((request) => request.url.pathname)
      .sort(),
  ).toEqual(["/api/world/events", "/api/world/macro", "/api/world/news"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("world: stale payload stays useful and Retry fetches the source again", async ({
  page,
  api,
}) => {
  api.worldEvents.sources[0] = {
    source: "USGS",
    fetchedAt: "2026-11-07T06:30:00.000Z",
    stale: true,
    error: "Upstream timeout",
  };
  await page.goto("/world");
  const feed = page.getByRole("region", { name: "Event feed", exact: true });
  await expect(feed).toContainText("Showing data from 12:00; source unavailable");
  await expect(feed.getByRole("button", { name: /offshore Japan/ })).toBeVisible();
  api.worldEvents.sources[0] = {
    source: "USGS",
    fetchedAt: "2026-11-07T07:30:00.000Z",
    stale: false,
  };
  await feed.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(feed).not.toContainText("source unavailable");
  await expect(feed).toContainText("USGS · updated 13:00 IST");
});

test("world: empty observations are explicit instead of fabricated", async ({ page, api }) => {
  api.worldEvents.events = [];
  api.worldNews.events = [];
  api.worldMacro.points = [];
  await page.goto("/world");
  await expect(page.getByText("No events in the selected categories.")).toBeVisible();
  await expect(page.getByText("No current events match an exposure rule.")).toBeVisible();
  await expect(page.getByText("No macro observations are available.")).toBeVisible();
});
