import type { Page, Request } from "@playwright/test";
import { PaperOrderCommandSchema } from "../../server/modules/paper-trading/contracts";
import { ACCESS_TOKEN, paperFillRow, paperOrderRow, type PaperOrderWire } from "./support/data";
import { test, expect, signIn } from "./support/fixtures";
import { API_ORIGIN, type MockApi } from "./support/mock-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isMutation = (path: string) => (request: Request) =>
  request.method() === "POST" && request.url() === `${API_ORIGIN}/api/trpc/${path}`;

/** The order ticket panel (its header holds the "Order Ticket" caption). */
function orderTicket(page: Page) {
  return page.getByText("Order Ticket", { exact: true }).locator("xpath=../..");
}

function priceInput(page: Page, label: "Limit Price (₹)" | "Trigger Price (₹)") {
  return orderTicket(page).locator(`div:has(> label:text-is("${label}")) > input`);
}

async function openSignedInTerminal(page: Page) {
  await signIn(page);
  await page.goto("/terminal");
  const ticket = orderTicket(page);
  // Quote fixture landed and the account from paperTrading.getState enables trading.
  await expect(ticket.getByText("₹2450.00", { exact: true })).toBeVisible();
  await expect(ticket.getByRole("button", { name: "BUY", exact: true })).toBeEnabled();
  return ticket;
}

test("paper terminal: a LIMIT order sends the contract payload, lists the fixture order and cancels it", async ({
  page,
  api,
}) => {
  const ticket = await openSignedInTerminal(page);

  await ticket.getByRole("button", { name: "LMT", exact: true }).click();
  await ticket.getByPlaceholder("Qty e.g. 10").fill("15");
  await priceInput(page, "Limit Price (₹)").fill("2400");

  const firstRequest = page.waitForRequest(isMutation("paperTrading.placeOrder"));
  await ticket.getByRole("button", { name: "BUY 15 RELIANCE", exact: true }).click();
  const first = await firstRequest;
  const firstBody = first.postDataJSON();
  expect(firstBody).toEqual({
    type: "LIMIT",
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    quantity: 15,
    limitPrice: 2400,
    clientOrderId: expect.stringMatching(UUID),
    idempotencyKey: expect.stringMatching(UUID),
  });
  expect(firstBody.idempotencyKey).not.toBe(firstBody.clientOrderId);
  // The backend's own (strict) input schema accepts it.
  expect(PaperOrderCommandSchema.safeParse(firstBody).success).toBe(true);
  expect(first.headers().authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  expect(first.headers()["content-type"]).toBe("application/json");

  await expect(ticket.getByText("Limit BUY order placed at ₹2400", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pending Orders (1)" }).click();
  const firstRow = page.getByRole("row").filter({ hasText: "₹2400.00" });
  await expect(firstRow.getByRole("cell")).toHaveText([
    /\d{2}:\d{2}/,
    "RELIANCE",
    "BUY",
    "LIMIT",
    "₹2400.00",
    "0/15",
    "15",
    "—",
    "Open",
    "Cancel",
  ]);

  // A second order carries fresh idempotency and client-order identifiers.
  await ticket.getByPlaceholder("Qty e.g. 10").fill("5");
  await priceInput(page, "Limit Price (₹)").fill("2390.5");
  const secondRequest = page.waitForRequest(isMutation("paperTrading.placeOrder"));
  await ticket.getByRole("button", { name: "BUY 5 RELIANCE", exact: true }).click();
  const secondBody = (await secondRequest).postDataJSON();
  expect(secondBody).toMatchObject({ type: "LIMIT", quantity: 5, limitPrice: 2390.5 });
  expect(secondBody.idempotencyKey).toMatch(UUID);
  expect(secondBody.clientOrderId).toMatch(UUID);
  expect(secondBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
  expect(secondBody.clientOrderId).not.toBe(firstBody.clientOrderId);
  await expect(page.getByRole("button", { name: "Pending Orders (2)" })).toBeVisible();
  expect(api.orders.map((order) => order.idempotencyKey)).toEqual([
    firstBody.idempotencyKey,
    secondBody.idempotencyKey,
  ]);

  const cancelRequest = page.waitForRequest(isMutation("paperTrading.cancelOrder"));
  await firstRow.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancel = await cancelRequest;
  expect(cancel.postDataJSON()).toEqual({ orderId: api.orders[0].id });
  expect(cancel.headers().authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

  await expect(page.getByRole("button", { name: "Pending Orders (1)" })).toBeVisible();
  await expect(firstRow).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "₹2390.50" })).toBeVisible();
});

test("paper terminal: a SL-LIMIT buy with its trigger above the limit is blocked with the reason", async ({
  page,
  api,
}) => {
  const ticket = await openSignedInTerminal(page);

  await ticket.getByRole("button", { name: "SL", exact: true }).click();
  await priceInput(page, "Trigger Price (₹)").fill("2500");
  await priceInput(page, "Limit Price (₹)").fill("2400");

  const reason = "For a buy stop, the trigger price must be at or below the limit price.";
  const submit = ticket.getByRole("button", { name: "BUY 10 RELIANCE", exact: true });
  await expect(ticket.getByRole("status").filter({ hasText: reason })).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(reason);
  await submit.click({ force: true });
  expect(api.trpcCalls("paperTrading.placeOrder")).toEqual([]);

  // Only the trigger was wrong: moving it to the limit's side unblocks the same order.
  await priceInput(page, "Trigger Price (₹)").fill("2395");
  await expect(ticket.getByText(reason)).toHaveCount(0);
  const request = page.waitForRequest(isMutation("paperTrading.placeOrder"));
  await submit.click();
  expect((await request).postDataJSON()).toMatchObject({
    type: "STOP_LOSS_LIMIT",
    side: "BUY",
    quantity: 10,
    stopPrice: 2395,
    limitPrice: 2400,
  });
  await expect(
    ticket.getByText("Stop-loss limit BUY order placed: trigger ₹2395, limit ₹2400", {
      exact: true,
    }),
  ).toBeVisible();
});

test("paper dashboard: a signed-in session keeps its account summary and trading actions", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByText("Portfolio equity", { exact: true })).toBeVisible();
  await expect(page.getByText("Positions overview", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await expect(page.getByText("Paper account requires sign-in.")).toHaveCount(0);
  await expect(page.locator("header").getByText("Sign-in coming soon", { exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByText("NIFTY 50", { exact: true })).toHaveCount(0);
});

/**
 * A LIMIT buy that has traded 4 of 10 shares and a triggered stop-limit that has not
 * traded yet: both still working, as the matcher leaves them (tick-processor.ts).
 */
function seedTradedWorkingOrders(api: MockApi): { partFilled: PaperOrderWire; triggered: PaperOrderWire } {
  const partFilled: PaperOrderWire = {
    ...paperOrderRow({
      id: "00000000-0000-4000-8000-000000000201",
      type: "LIMIT",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
      limitPrice: 2440,
      clientOrderId: "00000000-0000-4000-8000-000000000202",
      idempotencyKey: "00000000-0000-4000-8000-000000000203",
    }),
    status: "PARTIALLY_FILLED",
    filledQty: 4,
    averageFillPrice: "2439.5000",
    lastFillAt: "2026-11-06T10:10:00.000Z",
  };
  const triggered: PaperOrderWire = {
    ...paperOrderRow({
      id: "00000000-0000-4000-8000-000000000211",
      type: "STOP_LOSS_LIMIT",
      symbol: "TCS",
      exchange: "NSE",
      side: "SELL",
      quantity: 5,
      stopPrice: 3880,
      limitPrice: 3875,
      clientOrderId: "00000000-0000-4000-8000-000000000212",
      idempotencyKey: "00000000-0000-4000-8000-000000000213",
    }),
    status: "TRIGGERED",
    triggeredAt: "2026-11-06T10:12:00.000Z",
  };
  api.orders.push(partFilled, triggered);
  api.fills.push(
    paperFillRow(partFilled, { id: "00000000-0000-4000-8000-000000000204", quantity: 4, fillPrice: 2439.5, fees: 11.72 }),
  );
  return { partFilled, triggered };
}

test("paper terminal: part-filled and triggered orders stay working with their fills, and a cancel keeps the filled part", async ({
  page,
  api,
}) => {
  const { partFilled } = seedTradedWorkingOrders(api);
  await openSignedInTerminal(page);

  const tableWith = (column: string) =>
    page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: column, exact: true }) });
  const workingTable = tableWith("Remaining");
  await expect(async () => {
    await page.getByRole("button", { name: "Pending Orders (2)" }).click();
    await expect(workingTable).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const partRow = workingTable.getByRole("row").filter({ hasText: "RELIANCE" });
  await expect(partRow.getByRole("cell")).toHaveText([
    /\d{2}:\d{2}/,
    "RELIANCE",
    "BUY",
    "LIMIT",
    "₹2440.00",
    "4/10",
    "6",
    "₹2439.50",
    "Part filled",
    "Cancel",
  ]);
  await expect(workingTable.getByRole("row").filter({ hasText: "TCS" }).getByRole("cell")).toHaveText([
    /\d{2}:\d{2}/,
    "TCS",
    "SELL",
    "STOP_LOSS_LIMIT",
    "₹3875.00",
    "0/5",
    "5",
    "—",
    "Triggered",
    "Cancel",
  ]);

  const cancelRequest = page.waitForRequest(isMutation("paperTrading.cancelOrder"));
  await partRow.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancel = await cancelRequest;
  expect(cancel.postDataJSON()).toEqual({ orderId: partFilled.id });
  expect(cancel.headers().authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

  // The working tab drops it; the fill it already made stays in the history tab.
  await expect(page.getByRole("button", { name: "Pending Orders (1)" })).toBeVisible();
  await expect(partRow).toHaveCount(0);
  await page.getByRole("button", { name: "Fills History (1)" }).click();
  await expect(tableWith("Fill Price").getByRole("row").filter({ hasText: "RELIANCE" }).getByRole("cell")).toHaveText([
    /\d{2}:\d{2}/,
    "RELIANCE",
    "BUY",
    "4",
    "₹2439.50",
    "₹0.00",
    "₹11.72",
    "USER_ORDER",
  ]);
  expect(api.orders[0]).toMatchObject({ status: "CANCELLED", filledQty: 4 });
});

test("/orders: part-filled and triggered orders show quantities, average fill and Cancel; a cancel keeps the filled part", async ({
  page,
  api,
}) => {
  const { partFilled, triggered } = seedTradedWorkingOrders(api);
  await signIn(page);
  await page.goto("/orders");

  const partRow = page.getByRole("row").filter({ hasText: "RELIANCE" });
  const triggeredRow = page.getByRole("row").filter({ hasText: "TCS" });
  await expect(partRow.getByRole("cell")).toHaveText([
    /\d{2}/,
    /^RELIANCE/,
    "BUY",
    "Limit",
    "4/10",
    "6",
    "₹2,440.00",
    "₹2,439.50",
    "Part filled",
    "Cancel",
  ]);
  await expect(triggeredRow.getByRole("cell")).toHaveText([
    /\d{2}/,
    /^TCS/,
    "SELL",
    "SL limit",
    "0/5",
    "5",
    "₹3,875.00 · trig ₹3,880.00",
    "—",
    "Triggered",
    "Cancel",
  ]);

  const partCancel = page.waitForRequest(isMutation("paperTrading.cancelOrder"));
  await expect(async () => {
    await partRow.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 1_000 });
    await expect.poll(() => api.trpcCalls("paperTrading.cancelOrder").length, { timeout: 1_000 }).toBeGreaterThan(0);
  }).toPass();
  expect((await partCancel).postDataJSON()).toEqual({ orderId: partFilled.id });
  // Cancelled, with the 4 shares it bought and their average price still shown.
  await expect(partRow.getByRole("cell")).toHaveText([/\d{2}/, /^RELIANCE/, "BUY", "Limit", "4/10", "—", "₹2,440.00", "₹2,439.50", "Cancelled", ""]);

  const triggeredCancel = page.waitForRequest(isMutation("paperTrading.cancelOrder"));
  await triggeredRow.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await triggeredCancel).postDataJSON()).toEqual({ orderId: triggered.id });
  await expect(triggeredRow).toContainText("Cancelled");
  await expect(triggeredRow.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
});

test("paper dashboard: part-filled and triggered orders count as pending", async ({ page, api }) => {
  seedTradedWorkingOrders(api);
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByText("0 filled · 2 pending", { exact: true })).toBeVisible();
});
