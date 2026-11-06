import type { Page } from "@playwright/test";
import type { AlertView } from "../../server/modules/alerts/contracts";
import { FIXED_NOW, paperOrderRow } from "./support/data";
import { test, expect, signIn } from "./support/fixtures";
import { API_ORIGIN } from "./support/mock-api";

/**
 * Elements inside the page area whose content runs past their own box without a scroll
 * container to reach it: clipped buttons, or rows that push the page sideways.
 */
function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const element of document.querySelectorAll("main, main *")) {
      if (!(element instanceof HTMLElement) || element.clientWidth <= 1) continue;
      const style = getComputedStyle(element);
      if (style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis") continue;
      if (element.scrollWidth > element.clientWidth + 1) {
        offenders.push(`${element.tagName.toLowerCase()}.${element.className} (${element.scrollWidth} > ${element.clientWidth})`);
      }
    }
    return offenders;
  });
}

const SIGNED_OUT_NOTICES = [
  { path: "/orders", notice: "Paper orders and fills require a signed-in account." },
  { path: "/alerts", notice: "Price alerts require a signed-in account." },
  { path: "/watchlists", notice: "Named watchlists require a signed-in account." },
];

for (const { path, notice } of SIGNED_OUT_NOTICES) {
  test(`signed out: ${path} shows one sign-in notice and makes no protected calls`, async ({ page, api }) => {
    await page.goto(path);
    await expect(page.getByRole("status").filter({ hasText: notice })).toHaveCount(1);
    expect(api.trpcCalls()).toEqual([]);
    expect(api.requests.some(({ url }) => url.pathname.startsWith("/api/paper/"))).toBe(false);
  });
}

test("signed out: /watchlists edits the guest watchlist kept in this browser", async ({ page, api }) => {
  await page.goto("/watchlists");
  const watchlist = page.getByRole("region", { name: "Guest watchlist" });
  await expect(watchlist.getByRole("row").filter({ hasText: "TCS" })).toContainText("₹3,890.55");

  await expect(async () => {
    await watchlist.getByRole("textbox", { name: "Add a symbol or company" }).fill("elxsi");
    await expect(page.getByRole("button", { name: /TATAELXSI/ })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: /TATAELXSI/ }).click();
  const added = watchlist.getByRole("row").filter({ hasText: "TATAELXSI" });
  await expect(added).toContainText("₹6,745.80");
  await expect(added.getByRole("link", { name: "TATAELXSI" })).toHaveAttribute("href", "/stock/TATAELXSI");

  await page.reload();
  await expect(added).toBeVisible();
  await added.getByRole("button", { name: "Remove TATAELXSI" }).click();
  await expect(added).toHaveCount(0);
  expect(api.trpcCalls()).toEqual([]);
});

test("/news labels its placeholders once and has no live-looking actions", async ({ page, api }) => {
  await page.goto("/news");
  await expect(page.getByRole("status").filter({ hasText: "Sample headlines: no market news feed connected." })).toHaveCount(1);
  const headlines = page.getByRole("list", { name: "Sample headlines" }).getByRole("listitem");
  await expect(headlines).toHaveCount(5);
  await expect(headlines.getByRole("button")).toHaveCount(0);
  await expect(headlines.getByRole("link")).toHaveCount(0);

  await expect(async () => {
    await page.getByRole("button", { name: "Companies", exact: true }).click();
    await expect(headlines).toHaveCount(1, { timeout: 1_000 });
  }).toPass();
  await expect(headlines).toContainText("Reliance Industries");
  expect(api.requests.some(({ url }) => url.pathname.includes("news"))).toBe(false);
});

test("signed in: /orders lists a resting order with grouped prices, filters it and cancels it", async ({ page, api }) => {
  const order = paperOrderRow({
    id: "00000000-0000-4000-8000-000000000101",
    type: "LIMIT",
    symbol: "MARUTI",
    exchange: "NSE",
    side: "BUY",
    quantity: 2,
    limitPrice: 12400,
    clientOrderId: "00000000-0000-4000-8000-000000000102",
    idempotencyKey: "00000000-0000-4000-8000-000000000103",
  });
  api.orders.push(order);
  await signIn(page);
  await page.goto("/orders");

  const row = page.getByRole("row").filter({ hasText: "MARUTI" });
  await expect(row).toContainText("₹12,400.00");
  await expect(row).toContainText("0/2");
  await expect(row).toContainText("Open");

  await expect(async () => {
    await page.getByRole("button", { name: "Filled", exact: true }).click();
    await expect(page.getByText("No orders match this filter.")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(row).toBeVisible();

  const cancelRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url() === `${API_ORIGIN}/api/trpc/paperTrading.cancelOrder`,
  );
  await row.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await cancelRequest).postDataJSON()).toEqual({ orderId: order.id });
  await expect(row).toHaveCount(0);
});

test("signed in: /alerts lists an alert with its condition and state", async ({ page, api }) => {
  const alert: AlertView = {
    id: "00000000-0000-4000-8000-000000000201",
    symbol: "RELIANCE",
    exchange: "NSE",
    type: "PRICE_ABOVE",
    label: null,
    threshold: 2500,
    enabled: true,
    mode: "one_time",
    cooldownMinutes: 60,
    triggered: false,
    triggeredAt: null,
    lastTriggeredAt: null,
    triggerCount: 0,
    supported: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
  api.onQuery("alertsEngine.listAlerts", () => ({ items: [alert] }));
  api.onQuery("alertsEngine.listTriggerHistory", () => ({ items: [] }));
  api.onQuery("alertsEngine.listNotifications", () => ({ items: [] }));
  await signIn(page);
  await page.goto("/alerts");

  const row = page.getByRole("listitem").filter({ hasText: "RELIANCE" });
  await expect(row).toContainText("Price above ₹2,500.00");
  await expect(row).toContainText("Watching");
  await expect(page.getByRole("tab", { name: "Alerts 1" })).toHaveAttribute("aria-selected", "true");
});

test("signed in: /alerts reports an unreachable alert service instead of an empty list", async ({ page, api }) => {
  // No alertsEngine fixtures: every call fails like the API does while its database is down.
  await signIn(page);
  await page.goto("/alerts");
  await expect(page.getByRole("status").filter({ hasText: "Alerts could not be loaded right now." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "New alert" })).toHaveCount(0);
  expect(api.trpcCalls("alertsEngine.listAlerts").length).toBeGreaterThan(0);
});

// The mobile project emulates a 412 px phone; these checks pin the narrower 390 px width.
test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => !isMobile, "Phone layout check runs in the mobile project only");

  for (const path of ["/orders", "/journal", "/alerts", "/watchlists", "/news"]) {
    test(`signed out: ${path} fits the screen without clipping`, async ({ page, api }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("status").first()).toBeVisible();
      expect(await overflowingElements(page)).toEqual([]);
      expect(api.trpcCalls()).toEqual([]);
    });
  }

  test("signed in: /orders keeps its wide table inside a scroll container", async ({ page, api }) => {
    api.orders.push(
      paperOrderRow({
        id: "00000000-0000-4000-8000-000000000301",
        type: "STOP_LOSS_LIMIT",
        symbol: "HINDUNILVR",
        exchange: "NSE",
        side: "SELL",
        quantity: 10,
        limitPrice: 2350,
        stopPrice: 2360,
        clientOrderId: "00000000-0000-4000-8000-000000000302",
        idempotencyKey: "00000000-0000-4000-8000-000000000303",
      }),
    );
    await signIn(page);
    await page.goto("/orders");
    await expect(page.getByRole("row").filter({ hasText: "HINDUNILVR" })).toContainText("₹2,350.00 · trig ₹2,360.00");
    expect(await overflowingElements(page)).toEqual([]);
  });
});
