import { test, expect } from "./support/fixtures";
import { COMPANIES, FIELD_AVAILABILITY, FIXED_NOW, quoteFor } from "./support/data";

for (const width of [360, 768, 1440]) {
  test(`experimental navigation is keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/screener");
    // SSR controls exist before hydration; a rendered API quote proves handlers are mounted.
    await expect(page.getByLabel("Data source and as-of time")).toContainText("Price: Angel One · live");
    if (width < 1024) {
      const trigger = page.getByRole("button", { name: "Toggle Sidebar" });
      await trigger.focus();
      await page.keyboard.press("Enter");
    }
    const disclosure = page.getByRole("button", { name: "Experimental", exact: true });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Chart Grid", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(disclosure).toBeFocused();
    await page.keyboard.press("Space");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: "Chart Grid", exact: true })).toHaveCount(0);
    if (width < 1024) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Toggle Sidebar" })).toBeFocused();
    }
  });
}

test("screener prices retain row provenance and fresh quotes override stored observations", async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  const storedAt = "2000-01-03T10:00:00.000Z";
  await page.route("**/api/market/companies?*", (route) => route.fulfill({ json: {
    asOf: FIXED_NOW, source: "database", sourceSummary: ["Stored snapshots"], total: 2,
    universeTotal: 2, page: 1, pageSize: 50, pageCount: 1, fieldAvailability: FIELD_AVAILABILITY,
    items: [
      { ...COMPANIES[0], symbol: "DEMO-ARKA", name: "Arka (synthetic demo)", price: 456, quoteSource: "simulated", quoteAsOf: storedAt },
      { ...COMPANIES[0], symbol: "RELIANCE", price: 123, quoteSource: "yahoo", quoteAsOf: storedAt },
    ],
  } }));
  await page.route("**/api/market/quotes?*", (route) => route.fulfill({ json: {
    asOf: FIXED_NOW, source: "angelone", delayed: false, marketPhase: "OPEN",
    quotes: [quoteFor("RELIANCE", "open", 3333)], errors: [],
  } }));
  await page.route("**/api/market/stream?*", (route) => route.fulfill({
    contentType: "text/event-stream", body: "retry: 60000\n\n",
  }));
  await page.goto("/screener");
  const demo = page.getByRole("row").filter({ hasText: "DEMO-ARKA" });
  const real = page.getByRole("row").filter({ hasText: "RELIANCE" });
  await expect(page.getByRole("columnheader", { name: "Source · as of", exact: true })).toBeAttached();
  const headers = (await page.locator("thead th").allTextContents()).map((text) => text.trim());
  expect(headers).toContain("Price (₹)");
  expect(headers).toContain("Source · as of");
  const demoProvenance = demo.locator("td").nth(headers.indexOf("Source · as of"));
  const realProvenance = real.locator("td").nth(headers.indexOf("Source · as of"));
  await expect(demoProvenance).toHaveText("Price: Synthetic demo data · not market data · 03 Jan, 15:30 ISTStale");
  await expect(realProvenance).toHaveText("Price: Angel One · live · 06 Nov, 15:45 IST");
  const realPrice = real.locator("td").nth(headers.indexOf("Price (₹)"));
  await expect(realPrice).toHaveText("3,333.00");
});
