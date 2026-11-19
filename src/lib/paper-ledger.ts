import type { PaperLedgerEntryRow } from "../../server/modules/paper-trading/contracts";

/** A ledger row as paperTrading.listLedger sends it over JSON (timestamps as ISO strings). */
export type PaperLedgerEntry = Omit<PaperLedgerEntryRow, "createdAt"> & { createdAt: string };

/** One page of paperTrading.listLedger: newest first, `nextCursor` null on the last page. */
export interface PaperLedgerPage {
  entries: PaperLedgerEntry[];
  nextCursor: string | null;
}

/**
 * Ledger amounts are numeric(18,4). Sums run on integers of 1/10,000 rupee so a long ledger
 * adds up exactly instead of accumulating binary floating-point error.
 */
const UNITS_PER_RUPEE = 10_000;
const toUnits = (value: string | number): number => Math.round(Number(value) * UNITS_PER_RUPEE);
const toRupees = (units: number): number => units / UNITS_PER_RUPEE;

/** Cash differences below one paisa are rounding, the same tolerance the snapshot job uses. */
export const RECONCILIATION_TOLERANCE_INR = 0.01;

export interface LedgerRow {
  entry: PaperLedgerEntry;
  /** Signed cash movement, INR. */
  amount: number;
  /** Cash balance right after this entry posted, INR. */
  runningBalance: number;
}

/**
 * Running cash balance after each entry, for entries ordered newest first (the order
 * listLedger pages in). The newest entry's balance_after is the cash once it posted; each
 * older row's balance is the newer row's balance minus the newer row's amount. The two
 * entries of one fill (realised P&L and charges) share one balance_after, so walking the
 * amounts — not reading balance_after — gives each row its own balance. Holds for any
 * newest-first prefix, so older pages can be appended without recomputing loaded rows.
 */
export function withRunningBalances(entries: readonly PaperLedgerEntry[]): LedgerRow[] {
  const first = entries[0];
  if (!first) return [];
  let balance = toUnits(first.balanceAfter);
  return entries.map((entry) => {
    const amount = toUnits(entry.amount);
    const row = { entry, amount: toRupees(amount), runningBalance: toRupees(balance) };
    balance -= amount;
    return row;
  });
}

export interface LedgerTotals {
  /** INITIAL_CASH entries. */
  openingCash: number;
  /** TRADE_REALIZED_PNL entries (gross of charges). */
  realizedPnl: number;
  /** EXECUTION_FEE entries, as a positive cost. */
  charges: number;
  /** Any other entry type. */
  other: number;
  /** Sum of every amount: the cash the ledger accounts for. */
  net: number;
}

export function ledgerTotals(entries: readonly Pick<PaperLedgerEntry, "entryType" | "amount">[]): LedgerTotals {
  let opening = 0;
  let realized = 0;
  let fees = 0;
  let other = 0;
  for (const entry of entries) {
    const amount = toUnits(entry.amount);
    if (entry.entryType === "INITIAL_CASH") opening += amount;
    else if (entry.entryType === "TRADE_REALIZED_PNL") realized += amount;
    else if (entry.entryType === "EXECUTION_FEE") fees += amount;
    else other += amount;
  }
  return {
    openingCash: toRupees(opening),
    realizedPnl: toRupees(realized),
    charges: toRupees(0 - fees), // not -fees: no fees must read 0, not −0
    other: toRupees(other),
    net: toRupees(opening + realized + fees + other),
  };
}

export interface AccountReconciliation {
  openingCash: number;
  realizedPnl: number;
  /** From the ledger; null until every ledger page has loaded. */
  charges: number | null;
  cash: number;
  unrealizedPnl: number;
  positionsMarketValue: number;
  /** cash + unrealised P&L: positions are margin-funded, so buying does not debit cash. */
  equity: number;
  /** equity − opening cash = realised P&L − charges + unrealised P&L. */
  netPnl: number;
  /** account cash − ledger sum; null until every ledger page has loaded. */
  ledgerCashDifference: number | null;
  /** account realised P&L − ledger realised P&L; null until every ledger page has loaded. */
  realizedPnlDifference: number | null;
  /** Both differences are within RECONCILIATION_TOLERANCE_INR; null while the ledger is partial. */
  reconciled: boolean | null;
}

/**
 * The account row's cash and realised P&L checked against the full ledger, and the equity
 * the account is valued at. Pass `ledger: null` while older ledger pages are not loaded:
 * a partial ledger cannot confirm or contradict the balance.
 */
export function reconcileAccount(input: {
  account: { cashBalance: string; initialCash: string; realisedPnl: string };
  ledger: LedgerTotals | null;
  unrealizedPnl: number;
  positionsMarketValue: number;
}): AccountReconciliation {
  const cashUnits = toUnits(input.account.cashBalance);
  const openingUnits = toUnits(input.account.initialCash);
  const realizedUnits = toUnits(input.account.realisedPnl);
  const equityUnits = cashUnits + toUnits(input.unrealizedPnl);
  const { ledger } = input;
  const ledgerCashDifference = ledger ? toRupees(cashUnits - toUnits(ledger.net)) : null;
  const realizedPnlDifference = ledger ? toRupees(realizedUnits - toUnits(ledger.realizedPnl)) : null;
  return {
    openingCash: toRupees(openingUnits),
    realizedPnl: toRupees(realizedUnits),
    charges: ledger ? ledger.charges : null,
    cash: toRupees(cashUnits),
    unrealizedPnl: input.unrealizedPnl,
    positionsMarketValue: input.positionsMarketValue,
    equity: toRupees(equityUnits),
    netPnl: toRupees(equityUnits - openingUnits),
    ledgerCashDifference,
    realizedPnlDifference,
    reconciled:
      ledgerCashDifference === null || realizedPnlDifference === null
        ? null
        : Math.abs(ledgerCashDifference) < RECONCILIATION_TOLERANCE_INR &&
          Math.abs(realizedPnlDifference) < RECONCILIATION_TOLERANCE_INR,
  };
}

const ENTRY_TYPE_LABEL: Record<string, string> = {
  INITIAL_CASH: "Opening cash",
  TRADE_REALIZED_PNL: "Realised P&L",
  EXECUTION_FEE: "Charges",
};

export function ledgerEntryLabel(entryType: string): string {
  return ENTRY_TYPE_LABEL[entryType] ?? entryType.replaceAll("_", " ").toLowerCase();
}
