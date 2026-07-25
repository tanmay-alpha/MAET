import { PaperPersistenceError } from "./errors";
import type {
  PaperAccountRow,
  PaperOrderRow,
  PaperPositionRow,
  PaperFillRow,
  PaperLedgerEntryRow,
  PaperOutboxEventRow,
} from "./contracts";

export function parseFiniteDatabaseNumber(
  value: string | number | null | undefined,
  field: string
): number {
  if (value === null || value === undefined) {
    throw new PaperPersistenceError(`Missing numeric database field: ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new PaperPersistenceError(`Invalid numeric database value: ${field} = "${value}"`);
  }
  return parsed;
}

export function parseOptionalFiniteDatabaseNumber(
  value: string | number | null | undefined,
  field: string
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new PaperPersistenceError(`Invalid numeric database value: ${field} = "${value}"`);
  }
  return parsed;
}

export function mapPaperAccountRow(row: PaperAccountRow): PaperAccountRow {
  parseFiniteDatabaseNumber(row.cashBalance, "cashBalance");
  parseFiniteDatabaseNumber(row.initialCash, "initialCash");
  parseFiniteDatabaseNumber(row.realisedPnl, "realisedPnl");
  return row;
}

export function mapPaperOrderRow(row: PaperOrderRow): PaperOrderRow {
  return row;
}

export function mapPaperPositionRow(row: PaperPositionRow): PaperPositionRow {
  parseFiniteDatabaseNumber(row.averageEntryPrice, "averageEntryPrice");
  parseFiniteDatabaseNumber(row.realizedPnl, "realizedPnl");
  parseFiniteDatabaseNumber(row.marginLocked, "marginLocked");
  return row;
}

export function mapPaperFillRow(row: PaperFillRow): PaperFillRow {
  parseFiniteDatabaseNumber(row.referencePrice, "referencePrice");
  parseFiniteDatabaseNumber(row.fillPrice, "fillPrice");
  parseFiniteDatabaseNumber(row.slippage, "slippage");
  parseFiniteDatabaseNumber(row.fees, "fees");
  parseFiniteDatabaseNumber(row.realizedPnl, "realizedPnl");
  return row;
}

export function mapPaperLedgerEntryRow(row: PaperLedgerEntryRow): PaperLedgerEntryRow {
  parseFiniteDatabaseNumber(row.amount, "amount");
  parseFiniteDatabaseNumber(row.balanceAfter, "balanceAfter");
  return row;
}

export function mapPaperOutboxEventRow(row: PaperOutboxEventRow): PaperOutboxEventRow {
  return row;
}
