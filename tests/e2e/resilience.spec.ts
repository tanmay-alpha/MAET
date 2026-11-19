import type { Page } from "@playwright/test";
import { FIXED_NOW } from "./support/data";
import { test, expect, signIn } from "./support/fixtures";
import type { MockApi } from "./support/mock-api";

/** Makes paperTrading.getState return a position the page cannot render until `healthy()` is called. */
function serveCrashingPositions(api: MockApi) {
  let broken = true;
  api.onQuery("paperTrading.getState", () => ({
    account: api.account,
    positions: broken ? [null] : [],
    orders: [],
    fills: [],
    asOf: FIXED_NOW,
  }));
  return { healthy: () => void (broken = false) };
}

test("error boundary: a page that crashes shows a recoverable panel inside the app, and Try again recovers", async ({ page, api }) => {
  const backend = serveCrashingPositions(api);
  await signIn(page);
  await page.goto("/portfolio");

  const panel = page.getByRole("alert").filter({ hasText: "This page stopped working" });
  await expect(panel).toBeVisible();
  // The shell survives: header actions still work.
  await expect(page.getByRole("banner").getByRole("button", { name: "Account menu" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Settings" })).toBeVisible();

  backend.healthy();
  const refetched = api.trpcCalls("paperTrading.getState").length;
  await panel.getByRole("button", { name: "Try again" }).click();

  await expect(panel).toHaveCount(0);
  await expect(page.getByText("₹10,00,000.00 cash", { exact: true })).toBeVisible();
  // The crashed data was dropped and fetched again, not re-rendered from the cache.
  expect(api.trpcCalls("paperTrading.getState").length).toBeGreaterThan(refetched);
});

test("error boundary: navigating away from a crashed page clears the error", async ({ page, api }) => {
  serveCrashingPositions(api);
  await signIn(page);
  await page.goto("/portfolio");
  const panel = page.getByRole("alert").filter({ hasText: "This page stopped working" });
  await expect(panel).toBeVisible();

  await page.getByRole("banner").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

/** The drawing tool the chart page persisted for RELIANCE. */
function storedDrawingTool(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("maet_chart_layout_RELIANCE") ?? "{}").drawingTool ?? null);
}

test("keyboard: chart shortcuts leave selects, editable text and menus alone; the chart is labelled", async ({ page }) => {
  await page.goto("/chart/RELIANCE");
  await expect(page.getByRole("img", { name: "RELIANCE candlestick chart, 5 Days of 5m bars" })).toBeVisible();

  await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Probe select");
    for (const label of ["Alpha", "Trend", "Horizontal"]) select.append(new Option(label, label));
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.setAttribute("aria-label", "Probe editor");
    editor.setAttribute("role", "textbox");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    item.setAttribute("role", "menuitem");
    item.textContent = "Probe item";
    menu.append(item);
    main.prepend(select, editor, menu);
  });

  // Type-ahead in a native select must reach the select, not pick the trend-line tool.
  const select = page.getByRole("combobox", { name: "Probe select" });
  await select.focus();
  await page.keyboard.press("t");
  await expect(select).toHaveValue("Trend");
  expect(await storedDrawingTool(page)).toBeNull();

  const editor = page.getByRole("textbox", { name: "Probe editor" });
  await editor.focus();
  await page.keyboard.type("hvf");
  await expect(editor).toHaveText("hvf");
  expect(await storedDrawingTool(page)).toBeNull();

  await page.getByRole("menuitem", { name: "Probe item" }).focus();
  await page.keyboard.press("s");
  expect(await storedDrawingTool(page)).toBeNull();

  // Outside those, the shortcut still works.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("t");
  await expect.poll(() => storedDrawingTool(page)).toBe("trend");
});

const WIDTHS = [360, 768, 1440] as const;
const SIGNED_IN_PAGES = ["/portfolio", "/dashboard", "/orders", "/terminal", "/screener", "/chart/RELIANCE", "/backtest", "/compare", "/performance", "/strategies"];

/**
 * What sticks out sideways: the document's horizontal overflow, plus elements in <main>
 * that extend past its right edge without being inside a deliberate sideways scroller
 * (Tailwind overflow-x-auto/scroll, e.g. a wide table) or a clipping box (truncate). The
 * page's own vertical scroller does not count as a sideways one.
 */
function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    const documentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (documentOverflow > 0) offenders.push(`document (+${documentOverflow}px)`);
    const main = document.querySelector("main");
    if (!main) return offenders;
    const limit = main.getBoundingClientRect().right + 1;
    for (const element of main.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.right <= limit) continue;
      let contained = false;
      for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const sidewaysScroller = /\boverflow-x-(auto|scroll)\b|\boverflow-(auto|scroll)\b/.test(parent.className.toString());
        const clip = style.overflowX === "hidden" || style.overflowX === "clip";
        if ((sidewaysScroller || clip) && parent.getBoundingClientRect().right <= limit) {
          contained = true;
          break;
        }
      }
      if (!contained) {
        offenders.push(`${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 60)} (right ${Math.round(rect.right)} > ${Math.round(limit)})`);
      }
    }
    return offenders.slice(0, 5);
  });
}

/** Rows for the pages' wide tables, so the sweep measures them filled rather than empty. */
function serveTableRows(api: MockApi) {
  api.onQuery("backtestV2.listRuns", () => ({
    runs: ["RELIANCE", "HDFCBANK"].map((symbol, index) => ({
      id: `run-${index}`, symbol, timeframe: "1d", strategy: "SMA_CROSS", createdAt: FIXED_NOW,
      result: { metrics: { totalReturn: 0.1234, maxDrawdown: -0.0567, sharpe: 1.23 }, signalCount: 42 },
    })),
  }));
  api.onQuery("strategyBacktests.listJobs", () => ({
    jobs: ["RELIANCE", "HDFCBANK"].map((symbol, index) => ({
      id: `job-${index}`, status: "COMPLETED", symbolOrUniverse: symbol, timeframe: "1d",
      fromDate: "2024-01-01", toDate: "2026-11-01", requestedAt: FIXED_NOW,
    })),
  }));
  api.onQuery("strategyBacktests.getPerformance", () => ({ snapshot: null }));
  api.onQuery("strategyDefinitions.list", () => ({
    strategies: [{
      id: "22222222-2222-4222-8222-222222222222", name: "Momentum breakout with a long descriptive name",
      description: "Buys 20-day highs on above-average volume and exits on a trailing stop", status: "DRAFT", updatedAt: FIXED_NOW,
    }],
  }));
}

test.describe("responsive layout", () => {
  test.skip(({ isMobile, browserName }) => isMobile || browserName !== "chromium", "Viewport sweep runs once, in the desktop project");

  for (const width of WIDTHS) {
    test(`${width}px: key pages fit the viewport and the content gets the width`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      serveTableRows(api);
      await signIn(page);
      const overflowing: { path: string; overflow: string[] }[] = [];
      for (const path of SIGNED_IN_PAGES) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const overflow = await horizontalOverflow(page);
        if (overflow.length > 0) overflowing.push({ path, overflow });
      }
      expect(overflowing).toEqual([]);
      const mainWidth = await page.locator("main").evaluate((element) => element.getBoundingClientRect().width);
      if (width < 1024) {
        // No docked sidebar below lg: the page content spans the viewport…
        expect(mainWidth).toBeGreaterThanOrEqual(width - 1);
        // …and the menu opens as a sheet over it.
        await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        await expect(page.getByRole("dialog").getByRole("link", { name: "Portfolio", exact: true })).toBeVisible();
      } else {
        expect(mainWidth).toBeLessThan(width - 200);
        await expect(page.locator("[data-sidebar=sidebar]").getByRole("link", { name: "Portfolio", exact: true })).toBeVisible();
      }
    });

    test(`${width}px: screenshots of login and portfolio`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
      expect(await horizontalOverflow(page)).toEqual([]);
      await page.screenshot({ path: `test-results/screenshots/login-${width}.png`, fullPage: true });

      await signIn(page);
      await page.goto("/portfolio");
      await expect(page.getByRole("region", { name: "Cash and equity reconciliation" }).getByRole("status")).toContainText("Ledger reconciles");
      expect(await horizontalOverflow(page)).toEqual([]);
      expect(api.trpcCalls("paperTrading.listLedger").length).toBeGreaterThan(0);
      await page.screenshot({ path: `test-results/screenshots/portfolio-${width}.png`, fullPage: true });
    });
  }
});
