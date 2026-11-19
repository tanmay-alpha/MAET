import { describe, expect, test } from "bun:test";
import {
  ledgerTotals,
  reconcileAccount,
  withRunningBalances,
  type PaperLedgerEntry,
} from "./paper-ledger";

/** mulberry32: a small seeded PRNG so every run checks the same generated ledgers. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entry(input: Pick<PaperLedgerEntry, "id" | "entryType" | "amount" | "balanceAfter">): PaperLedgerEntry {
  return {
    ...input,
    userId: "u",
    generation: 1,
    fillId: null,
    currency: "INR",
    sourceType: input.entryType === "INITIAL_CASH" ? "ACCOUNT_OPEN" : "FILL",
    sourceId: input.id,
    metadata: {},
    createdAt: "2026-11-06T10:15:00.000Z",
  };
}

/** Exact paise-of-paise arithmetic for the expected values: amounts are numeric(18,4). */
const units = (value: string) => Math.round(Number(value) * 10_000);

/**
 * A ledger the way the engine writes one, newest first: INITIAL_CASH, then per fill a
 * realised-P&L and a charges entry that share one balance_after (cash after both), the
 * pair in either order (equal created_at, ordered by random uuid).
 */
function generateLedger(random: () => number) {
  const opening = 100_000 + Math.floor(random() * 5_000_000);
  let cash = opening * 10_000;
  let realized = 0;
  let fees = 0;
  const oldestFirst: PaperLedgerEntry[] = [
    entry({ id: "open", entryType: "INITIAL_CASH", amount: opening.toFixed(4), balanceAfter: opening.toFixed(4) }),
  ];
  const fills = Math.floor(random() * 40);
  for (let fill = 0; fill < fills; fill++) {
    const pnl = random() < 0.4 ? 0 : Math.round((random() - 0.45) * 50_000_000); // in 1/10,000 ₹
    const fee = Math.round(random() * 2_000_000);
    cash += pnl - fee;
    realized += pnl;
    fees += fee;
    const balanceAfter = (cash / 10_000).toFixed(4);
    const pair = [
      entry({ id: `pnl-${fill}`, entryType: "TRADE_REALIZED_PNL", amount: (pnl / 10_000).toFixed(4), balanceAfter }),
      entry({ id: `fee-${fill}`, entryType: "EXECUTION_FEE", amount: (-fee / 10_000).toFixed(4), balanceAfter }),
    ];
    oldestFirst.push(...(random() < 0.5 ? pair : pair.reverse()));
  }
  return { newestFirst: oldestFirst.reverse(), opening, cash: cash / 10_000, realized: realized / 10_000, fees: fees / 10_000 };
}

describe("withRunningBalances", () => {
  test("every row's balance is the next older row's balance plus its own amount, ending at zero before opening cash", () => {
    const random = prng(20261110);
    for (let run = 0; run < 300; run++) {
      const { newestFirst, cash } = generateLedger(random);
      const rows = withRunningBalances(newestFirst);

      expect(rows[0]!.runningBalance).toBe(cash);
      for (let index = 0; index + 1 < rows.length; index++) {
        expect(units(String(rows[index]!.runningBalance)) - units(String(rows[index]!.amount))).toBe(
          units(String(rows[index + 1]!.runningBalance)),
        );
      }
      const oldest = rows.at(-1)!;
      expect(oldest.entry.entryType).toBe("INITIAL_CASH");
      expect(units(String(oldest.runningBalance))).toBe(units(String(oldest.amount)));
    }
  });

  test("the later entry of each fill shows the balance the server recorded for the fill", () => {
    const random = prng(7);
    for (let run = 0; run < 200; run++) {
      const rows = withRunningBalances(generateLedger(random).newestFirst);
      // Newest first, the first row of each fill's pair is the one posted last.
      for (let index = 0; index < rows.length; index++) {
        const previous = rows[index - 1];
        const isLaterOfPair = rows[index]!.entry.entryType !== "INITIAL_CASH" &&
          (!previous || previous.entry.id.slice(4) !== rows[index]!.entry.id.slice(4));
        if (isLaterOfPair) {
          expect(units(String(rows[index]!.runningBalance))).toBe(units(rows[index]!.entry.balanceAfter));
        }
      }
    }
  });

  test("a newest-first page shows the same balances as the full ledger (older pages can be appended)", () => {
    const random = prng(99);
    for (let run = 0; run < 200; run++) {
      const { newestFirst } = generateLedger(random);
      const full = withRunningBalances(newestFirst);
      const pageSize = 1 + Math.floor(random() * newestFirst.length);
      const page = withRunningBalances(newestFirst.slice(0, pageSize));
      expect(page.map((row) => row.runningBalance)).toEqual(full.slice(0, pageSize).map((row) => row.runningBalance));
    }
  });

  test("is empty for an empty ledger", () => {
    expect(withRunningBalances([])).toEqual([]);
  });
});

describe("ledgerTotals", () => {
  test("splits amounts by type and sums them exactly, with no floating-point drift", () => {
    const random = prng(42);
    for (let run = 0; run < 300; run++) {
      const ledger = generateLedger(random);
      const totals = ledgerTotals(ledger.newestFirst);
      expect(totals.openingCash).toBe(ledger.opening);
      expect(totals.realizedPnl).toBe(ledger.realized);
      expect(totals.charges).toBe(ledger.fees);
      expect(totals.net).toBe(ledger.cash);
      expect(totals.other).toBe(0);
    }
  });

  test("ten thousand ₹0.1 charges add up to exactly ₹1,000", () => {
    // Plain float addition of 0.1 ten thousand times gives 1000.0000000001588.
    const entries = Array.from({ length: 10_000 }, () => ({ entryType: "EXECUTION_FEE", amount: "-0.1000" }));
    expect(ledgerTotals(entries).charges).toBe(1000);
  });

  test("keeps unknown entry types out of P&L and charges but in the net", () => {
    const totals = ledgerTotals([
      { entryType: "INITIAL_CASH", amount: "1000.0000" },
      { entryType: "MANUAL_ADJUSTMENT", amount: "-12.5000" },
    ]);
    expect(totals).toEqual({ openingCash: 1000, realizedPnl: 0, charges: 0, other: -12.5, net: 987.5 });
  });
});

describe("reconcileAccount", () => {
  const account = { cashBalance: "1001195.8500", initialCash: "1000000.0000", realisedPnl: "1250.5000" };

  test("a full ledger that sums to the account's cash reconciles; equity is cash plus unrealised P&L", () => {
    const ledger = ledgerTotals([
      { entryType: "EXECUTION_FEE", amount: "-31.2000" },
      { entryType: "TRADE_REALIZED_PNL", amount: "1250.5000" },
      { entryType: "EXECUTION_FEE", amount: "-23.4500" },
      { entryType: "TRADE_REALIZED_PNL", amount: "0.0000" },
      { entryType: "INITIAL_CASH", amount: "1000000.0000" },
    ]);
    const result = reconcileAccount({ account, ledger, unrealizedPnl: -420.25, positionsMarketValue: 245_000 });
    expect(result).toMatchObject({
      openingCash: 1_000_000,
      realizedPnl: 1250.5,
      charges: 54.65,
      cash: 1_001_195.85,
      equity: 1_000_775.6,
      netPnl: 775.6,
      ledgerCashDifference: 0,
      realizedPnlDifference: 0,
      reconciled: true,
    });
    // Margin-funded positions: their market value is exposure, not part of equity.
    expect(result.equity).not.toBe(result.cash + result.positionsMarketValue);
  });

  test("a missing fee entry is reported as the exact cash difference", () => {
    const ledger = ledgerTotals([
      { entryType: "TRADE_REALIZED_PNL", amount: "1250.5000" },
      { entryType: "EXECUTION_FEE", amount: "-23.4500" },
      { entryType: "INITIAL_CASH", amount: "1000000.0000" },
    ]);
    const result = reconcileAccount({ account, ledger, unrealizedPnl: 0, positionsMarketValue: 0 });
    expect(result.ledgerCashDifference).toBe(-31.2);
    expect(result.realizedPnlDifference).toBe(0);
    expect(result.reconciled).toBe(false);
  });

  test("differences under one paisa are rounding, at one paisa they are not", () => {
    const ledgerAt = (cash: string) =>
      reconcileAccount({
        account: { cashBalance: cash, initialCash: "1000.0000", realisedPnl: "0.0000" },
        ledger: ledgerTotals([{ entryType: "INITIAL_CASH", amount: "1000.0000" }]),
        unrealizedPnl: 0,
        positionsMarketValue: 0,
      }).reconciled;
    expect(ledgerAt("1000.0099")).toBe(true);
    expect(ledgerAt("1000.0100")).toBe(false);
    expect(ledgerAt("999.9901")).toBe(true);
  });

  test("a partial ledger neither confirms nor contradicts the balance", () => {
    const result = reconcileAccount({ account, ledger: null, unrealizedPnl: 10, positionsMarketValue: 0 });
    expect(result).toMatchObject({ charges: null, ledgerCashDifference: null, realizedPnlDifference: null, reconciled: null });
    expect(result.equity).toBe(1_001_205.85);
  });
});
