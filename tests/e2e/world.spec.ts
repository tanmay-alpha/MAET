import { test, expect } from "./support/fixtures";
import type { MockApi } from "./support/mock-api";
import { eonetUpstream, gdeltUpstream } from "./support/world-data";

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
  // The server had every source, so the page never asked EONET or GDELT itself.
  expect(api.upstreamRequests).toEqual([]);
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

/** The server's answer when Render cannot reach NASA EONET or GDELT on a cold cache. */
function serverCannotReachUpstreams(api: MockApi) {
  api.worldEvents.sources[1] = {
    source: "NASA EONET",
    fetchedAt: null,
    stale: true,
    error: "fetch failed (ETIMEDOUT)",
  };
  api.worldNews.events = [];
  api.worldNews.sources = [
    { source: "GDELT", fetchedAt: null, stale: true, error: "Upstream request timed out" },
  ];
}

const BROWSER_FOOTER = (source: string) =>
  new RegExp(`${source} · fetched by your browser · updated \\d{2}:\\d{2} IST`);

test("world: sources the server cannot reach are fetched once by the browser and merged", async ({
  page,
  api,
}) => {
  serverCannotReachUpstreams(api);
  api.worldUpstreams = { eonet: eonetUpstream(), gdelt: gdeltUpstream() };
  await page.goto("/world");
  const feed = page.getByRole("region", { name: "Event feed", exact: true });
  const cyclone = feed.getByRole("article").filter({ hasText: "Tropical Cyclone Dana" });
  await expect(cyclone).toBeVisible();
  await expect(cyclone).toContainText("55 kts");
  await expect(cyclone).not.toContainText("Not mapped");
  await expect(
    feed.getByRole("button", { name: /Federal Reserve holds policy rate as inflation cools/ }),
  ).toBeVisible();
  await expect(feed.getByRole("button", { name: /offshore Japan/ })).toBeVisible();
  await expect(feed.locator("footer")).toContainText(BROWSER_FOOTER("NASA EONET"));
  await expect(feed.locator("footer")).toContainText(BROWSER_FOOTER("GDELT"));
  await expect(feed.locator("footer")).toContainText("USGS · updated 12:00 IST");
  await expect(feed).not.toContainText("ETIMEDOUT");
  await expect(feed).not.toContainText("Upstream request timed out");
  const map = page.getByRole("region", { name: "World map", exact: true });
  await expect(map.locator("footer")).toContainText(BROWSER_FOOTER("NASA EONET"));
  const exposure = page.getByRole("region", { name: "Market exposure", exact: true });
  await expect(exposure).toContainText("Tropical Cyclone Dana");
  await expect(exposure).toContainText("Federal Reserve holds policy rate as inflation cools");
  await expect(exposure.locator("footer")).toContainText(BROWSER_FOOTER("GDELT"));

  const hosts = api.upstreamRequests.map((url) => url.hostname).sort();
  expect(hosts).toEqual(["api.gdeltproject.org", "eonet.gsfc.nasa.gov"]);
  const gdelt = api.upstreamRequests.find((url) => url.hostname === "api.gdeltproject.org")!;
  expect(Number(gdelt.searchParams.get("maxrecords"))).toBeLessThanOrEqual(50);
  expect(gdelt.searchParams.get("query")).toContain(" OR ");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("world: a failed browser fetch keeps the server's error line and Retry tries again", async ({
  page,
  api,
}) => {
  serverCannotReachUpstreams(api);
  await page.goto("/world");
  const feed = page.getByRole("region", { name: "Event feed", exact: true });
  const hosts = () => api.upstreamRequests.map((url) => url.hostname).sort();
  await expect.poll(hosts).toEqual(["api.gdeltproject.org", "eonet.gsfc.nasa.gov"]);
  await expect(feed).not.toContainText("fetching from your browser");
  await expect(feed).toContainText("NASA EONET: fetch failed (ETIMEDOUT)");
  await expect(feed).toContainText("GDELT: Upstream request timed out");
  await expect(feed.locator("footer")).toContainText("NASA EONET · not yet available");
  expect(hosts()).toHaveLength(2);

  api.worldUpstreams.eonet = eonetUpstream();
  await feed
    .getByRole("status")
    .filter({ hasText: "NASA EONET" })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(feed.getByRole("button", { name: /Tropical Cyclone Dana/ })).toBeVisible();
  await expect(feed.locator("footer")).toContainText(BROWSER_FOOTER("NASA EONET"));
  await expect(feed).not.toContainText("ETIMEDOUT");
  await expect(feed).toContainText("GDELT: Upstream request timed out");
  expect(api.upstreamRequests.filter((url) => url.hostname === "eonet.gsfc.nasa.gov")).toHaveLength(
    2,
  );
});
