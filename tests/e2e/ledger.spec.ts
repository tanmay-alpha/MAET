import type { Page } from "@playwright/test";
import { paperLedgerRow, paperOrderRow, FIXED_NOW } from "./support/data";
import { test, expect, signIn } from "./support/fixtures";
import type { MockApi } from "./support/mock-api";

const FILL_1 = "00000000-0000-4000-a000-000000000001";
const FILL_2 = "00000000-0000-4000-a000-000000000002";

/**
 * A traded account and its ledger, newest first, as the engine writes them: a BUY (no
 * realised P&L, ₹23.45 charges), then a SELL realising ₹1,250.50 with ₹31.20 charges.
 * Both entries of a fill carry the cash after the fill as balance_after.
 */
function seedTradedAccount(api: MockApi) {
  api.account = { ...api.account, cashBalance: "1001195.8500", realisedPnl: "1250.5000", lastEquity: "1001195.8500" };
  api.ledger = [
    paperLedgerRow({ id: "00000000-0000-4000-9000-000000000005", entryType: "TRADE_REALIZED_PNL", amount: 1250.5, balanceAfter: 1001195.85, createdAt: "2026-10-20T05:30:00.000Z", fillId: FILL_2, metadata: { side: "SELL", qty: 10, fillPrice: 2575.55 } }),
    paperLedgerRow({ id: "00000000-0000-4000-9000-000000000004", entryType: "EXECUTION_FEE", amount: -31.2, balanceAfter: 1001195.85, createdAt: "2026-10-20T05:30:00.000Z", fillId: FILL_2 }),
    paperLedgerRow({ id: "00000000-0000-4000-9000-000000000003", entryType: "TRADE_REALIZED_PNL", amount: 0, balanceAfter: 999976.55, createdAt: "2026-10-05T04:00:00.000Z", fillId: FILL_1, metadata: { side: "BUY", qty: 10, fillPrice: 2450.5 } }),
    paperLedgerRow({ id: "00000000-0000-4000-9000-000000000002", entryType: "EXECUTION_FEE", amount: -23.45, balanceAfter: 999976.55, createdAt: "2026-10-05T04:00:00.000Z", fillId: FILL_1 }),
    paperLedgerRow({ id: "00000000-0000-4000-9000-000000000001", entryType: "INITIAL_CASH", amount: 1_000_000, balanceAfter: 1_000_000, createdAt: "2026-10-01T04:00:00.000Z" }),
  ];
}

/** [type, amount, balance] of each ledger row, top to bottom. */
const EXPECTED_ROWS = [
  ["Realised P&L", "+₹1,250.50", "₹10,01,195.85"],
  ["Charges", "−₹31.20", "₹9,99,945.35"],
  ["Realised P&L", "₹0.00", "₹9,99,976.55"],
  ["Charges", "−₹23.45", "₹9,99,976.55"],
  ["Opening cash", "+₹10,00,000.00", "₹10,00,000.00"],
];

async function ledgerRows(page: Page) {
  const rows = page.getByRole("table", { name: "Cash ledger entries" }).locator("tbody tr");
  return rows.evaluateAll((elements) =>
    elements.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "")),
  );
}

test("ledger: /portfolio lists every cash movement with its running balance in INR", async ({ page, api }) => {
  seedTradedAccount(api);
  await signIn(page);
  await page.goto("/portfolio");

  const table = page.getByRole("table", { name: "Cash ledger entries" });
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByText("Amounts in INR (₹) · newest first · balance after each entry")).toBeVisible();
  const rows = await ledgerRows(page);
  expect(rows.map(([, type, , amount, balance]) => [type, amount, balance])).toEqual(EXPECTED_ROWS);
  // Timestamps are shown in IST with the date: 20 Oct 2026 05:30 UTC is 11:00 IST.
  expect(rows[0]![0]).toMatch(/^20 Oct 2026, 11:00:00 IST$/);
  expect(rows[0]![2]).toBe("Fill: SELL 10 @ ₹2,575.55");

  const reconciliation = page.getByRole("region", { name: "Cash and equity reconciliation" });
  await expect(reconciliation.getByRole("status")).toHaveText("Ledger reconciles: its 5 entries sum to the cash balance.");
  // [label, value] per line; the label is the term's first text, before its explanatory note.
  const lines = await reconciliation.locator("dl > div").evaluateAll((elements) =>
    elements.map((row) => [row.querySelector("dt")?.firstChild?.textContent?.trim(), row.querySelector("dd")?.textContent?.trim()]),
  );
  expect(lines).toEqual([
    ["Opening cash", "₹10,00,000.00"],
    ["+ Realised P&L", "+₹1,250.50"],
    ["− Charges", "₹54.65"],
    ["= Cash balance", "₹10,01,195.85"],
    ["+ Unrealised P&L", "₹0.00"],
    ["= Equity", "₹10,01,195.85"],
    ["Net P&L after charges", "+₹1,195.85"],
    ["Positions market value", "₹0.00"],
  ]);
  expect(api.trpcCalls("paperTrading.listLedger")[0]?.headers.authorization).toMatch(/^Bearer /);
});

test("ledger: older pages load on demand and cash is only verified once the whole ledger is in", async ({ page, api }) => {
  seedTradedAccount(api);
  api.ledgerPageLimit = 2;
  await signIn(page);
  await page.goto("/portfolio");

  const table = page.getByRole("table", { name: "Cash ledger entries" });
  const status = page.getByRole("region", { name: "Cash and equity reconciliation" }).getByRole("status");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(status).toHaveText("Load the older ledger entries to verify cash against the full ledger.");

  const more = page.getByRole("button", { name: "Load older entries" });
  await more.click();
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await more.click();
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(more).toHaveCount(0);
  // Balances computed across page boundaries match a single-page read.
  expect((await ledgerRows(page)).map(([, type, , amount, balance]) => [type, amount, balance])).toEqual(EXPECTED_ROWS);
  await expect(status).toHaveText("Ledger reconciles: its 5 entries sum to the cash balance.");
});

test("ledger: a cash balance the ledger does not account for is flagged with the difference", async ({ page, api }) => {
  seedTradedAccount(api);
  // The ₹31.20 charge of the SELL is missing from the ledger.
  api.ledger.splice(1, 1);
  await signIn(page);
  await page.goto("/portfolio");

  await expect(page.getByRole("region", { name: "Cash and equity reconciliation" }).getByRole("status")).toHaveText(
    "Ledger does not reconcile: cash differs by −₹31.20, realised P&L by ₹0.00.",
  );
});

test("orders: a rejected order shows the reason the engine recorded", async ({ page, api }) => {
  api.orders.push({
    ...paperOrderRow({
      id: "00000000-0000-4000-8000-000000000301",
      type: "MARKET",
      symbol: "TCS",
      exchange: "NSE",
      side: "BUY",
      quantity: 5000,
      clientOrderId: "00000000-0000-4000-8000-000000000302",
      idempotencyKey: "00000000-0000-4000-8000-000000000303",
    }),
    status: "REJECTED",
    rejectReason: "Insufficient margin",
    updatedAt: FIXED_NOW,
  });
  await signIn(page);
  await page.goto("/orders");

  const row = page.getByRole("row").filter({ hasText: "TCS" });
  await expect(row).toContainText("Rejected(Insufficient margin)");
  await page.getByRole("button", { name: "Rejected", exact: true }).click();
  await expect(row).toBeVisible();
});
