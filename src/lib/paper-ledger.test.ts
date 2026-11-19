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

function entry(
  input: Pick<PaperLedgerEntry, "id" | "entryType" | "amount" | "balanceAfter"> & Partial<Pick<PaperLedgerEntry, "fillId" | "createdAt">>,
): PaperLedgerEntry {
  return {
    userId: "u",
    generation: 1,
    fillId: null,
    currency: "INR",
    sourceType: input.entryType === "INITIAL_CASH" ? "ACCOUNT_OPEN" : "FILL",
    sourceId: input.fillId ?? input.id,
    metadata: {},
    createdAt: "2026-11-06T10:15:00.000Z",
    ...input,
  };
}

/** Exact paise-of-paise arithmetic for the expected values: amounts are numeric(18,4). */
const units = (value: string) => Math.round(Number(value) * 10_000);
const rupees = (tenThousandths: number) => (tenThousandths / 10_000).toFixed(4);

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

/**
 * A ledger the way the engine writes one: INITIAL_CASH, then per fill a realised-P&L row and
 * then a charges row with one created_at; a margin liquidation writes several fills with one
 * created_at. `legacy` rows share the fill's final cash as balance_after (engine before
 * running balances); otherwise each row records the cash after itself. Returns the true
 * posting history newest first, and what listLedger returns: newest created_at first with
 * ties in uuid (here: random) order.
 */
function generateLedger(random: () => number, legacy = random() < 0.5) {
  const opening = 100_000 + Math.floor(random() * 5_000_000);
  let cash = opening * 10_000;
  let realized = 0;
  let fees = 0;
  let time = Date.parse("2026-10-01T04:00:00.000Z");
  const history: Array<{ entry: PaperLedgerEntry; balance: number }> = [
    { entry: entry({ id: "open", entryType: "INITIAL_CASH", amount: rupees(cash), balanceAfter: rupees(cash), createdAt: new Date(time).toISOString() }), balance: cash },
  ];
  const fills = Math.floor(random() * 40);
  for (let fill = 0; fill < fills; fill++) {
    // A liquidation posts its fills in one transaction, so they share a created_at.
    if (random() < 0.7) time += 60_000 + Math.floor(random() * 86_400_000);
    const createdAt = new Date(time).toISOString();
    const pnl = random() < 0.4 ? 0 : Math.round((random() - 0.45) * 50_000_000); // in 1/10,000 ₹
    const fee = 1 + Math.round(random() * 2_000_000);
    const afterPnl = cash + pnl;
    cash = afterPnl - fee;
    realized += pnl;
    fees += fee;
    const fillId = `fill-${fill}`;
    history.push(
      { entry: entry({ id: `pnl-${fill}`, fillId, createdAt, entryType: "TRADE_REALIZED_PNL", amount: rupees(pnl), balanceAfter: rupees(legacy ? cash : afterPnl) }), balance: afterPnl },
      { entry: entry({ id: `fee-${fill}`, fillId, createdAt, entryType: "EXECUTION_FEE", amount: rupees(-fee), balanceAfter: rupees(cash) }), balance: cash },
    );
  }
  const posted = history.reverse();
  const groups = new Map<string, PaperLedgerEntry[]>();
  for (const { entry: row } of posted) groups.set(row.createdAt, [...(groups.get(row.createdAt) ?? []), row]);
  const served = [...groups.values()].flatMap((group) => shuffle(group, random));
  return { posted, served, opening, cash: cash / 10_000, realized: realized / 10_000, fees: fees / 10_000 };
}

describe("withRunningBalances", () => {
  test("shows rows in posting order with the cash after each, whatever order equal timestamps arrive in", () => {
    const random = prng(20261110);
    for (let run = 0; run < 400; run++) {
      const { posted, served } = generateLedger(random);
      const rows = withRunningBalances(served);
      expect(rows.map((row) => [row.entry.id, units(String(row.runningBalance))])).toEqual(
        posted.map(({ entry: row, balance }) => [row.id, balance]),
      );
    }
  });

  test("for running-balance rows, every displayed balance is the one the server recorded", () => {
    const random = prng(7);
    for (let run = 0; run < 200; run++) {
      const rows = withRunningBalances(generateLedger(random, false).served);
      for (const row of rows) expect(units(String(row.runningBalance))).toBe(units(row.entry.balanceAfter));
    }
  });

  test("each row's balance is the next older row's plus its own amount, down to the opening cash", () => {
    const random = prng(31);
    for (let run = 0; run < 200; run++) {
      const { served, cash } = generateLedger(random);
      const rows = withRunningBalances(served);
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

  test("the rows of a page keep their balances when older pages are appended", () => {
    const random = prng(99);
    for (let run = 0; run < 200; run++) {
      const { served } = generateLedger(random);
      const full = withRunningBalances(served);
      // A page boundary never splits a created_at group in this check: listLedger pages by
      // (created_at, id), so a group split across pages is only ordered once both are loaded.
      const boundaries = served.flatMap((row, index) => (index > 0 && served[index - 1]!.createdAt !== row.createdAt ? [index] : []));
      if (boundaries.length === 0) continue;
      const pageSize = boundaries[Math.floor(random() * boundaries.length)]!;
      const page = withRunningBalances(served.slice(0, pageSize));
      expect(page.map((row) => [row.entry.id, row.runningBalance])).toEqual(
        full.slice(0, pageSize).map((row) => [row.entry.id, row.runningBalance]),
      );
    }
  });

  test("legacy fill rows sharing one balance_after still get their own balances, charges listed last-posted", () => {
    const rows = withRunningBalances([
      entry({ id: "b", fillId: "f", entryType: "TRADE_REALIZED_PNL", amount: "0.0000", balanceAfter: "999976.5500" }),
      entry({ id: "a", fillId: "f", entryType: "EXECUTION_FEE", amount: "-23.4500", balanceAfter: "999976.5500" }),
      entry({ id: "o", entryType: "INITIAL_CASH", amount: "1000000.0000", balanceAfter: "1000000.0000", createdAt: "2026-10-01T04:00:00.000Z" }),
    ]);
    expect(rows.map((row) => [row.entry.id, row.runningBalance])).toEqual([
      ["a", 999_976.55],
      ["b", 1_000_000],
      ["o", 1_000_000],
    ]);
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
      const totals = ledgerTotals(ledger.served);
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
