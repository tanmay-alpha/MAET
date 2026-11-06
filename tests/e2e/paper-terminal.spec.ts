import type { Page, Request } from "@playwright/test";
import { PaperOrderCommandSchema } from "../../server/modules/paper-trading/contracts";
import { ACCESS_TOKEN } from "./support/data";
import { test, expect, signIn } from "./support/fixtures";
import { API_ORIGIN } from "./support/mock-api";

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
    "15",
    "PENDING",
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
  await expect(page.getByText("Paper account balances and positions require a signed-in account.")).toHaveCount(0);
  await expect(page.locator("header").getByText("Sign-in coming soon", { exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByText("NIFTY 50", { exact: true })).toHaveCount(0);
});
