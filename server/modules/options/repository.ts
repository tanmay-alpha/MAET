import { sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import {
  optionContracts,
  optionGreekSnapshots,
  optionQuoteSnapshots,
} from "../../db/schema";
import type {
  AngelOneFullMarketQuote,
  AngelOneOptionContract,
  AngelOneOptionGreek,
} from "../../data/sources/angelone/client";

const ANGELONE_PROVIDER = "angelone";
const NFO_EXCHANGE = "NFO";
const EXPIRY_MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

type OptionType = "CE" | "PE";
type InstrumentType = "OPTIDX" | "OPTSTK";

export type CanonicalOptionContract = {
  id: string;
  token: string;
  tradingSymbol: string;
  strikePrice: string;
  optionType: OptionType;
  instrumentType: InstrumentType;
};

export type OptionQuoteSnapshotInput = {
  contractId: string;
  quote: AngelOneFullMarketQuote;
};

export type OptionGreekSnapshotInput = {
  contractId: string;
  greek: AngelOneOptionGreek;
};

export type OptionSnapshotWriteResult = {
  attempted: number;
  inserted: number;
  duplicates: number;
  unusable: number;
};

type OptionContractSyncInput = {
  underlying: string;
  expiryDate: string;
  contracts: AngelOneOptionContract[];
};

export function normalizeAngelOneOptionExpiry(expiry: string): string {
  const normalized = expiry.trim().toUpperCase();
  const match = /^(\d{2})([A-Z]{3})(\d{4})$/u.exec(normalized);
  if (!match) throw new Error("option chain requires a valid DDMMMYYYY expiry");

  const day = Number(match[1]);
  const month = EXPIRY_MONTHS[match[2]];
  const year = Number(match[3]);
  if (month === undefined || year < 1) {
    throw new Error("option chain requires a valid DDMMMYYYY expiry");
  }

  const validationDate = new Date(0);
  validationDate.setUTCHours(0, 0, 0, 0);
  validationDate.setUTCFullYear(year, month - 1, day);
  if (
    validationDate.getUTCFullYear() !== year
    || validationDate.getUTCMonth() !== month - 1
    || validationDate.getUTCDate() !== day
  ) {
    throw new Error("option chain requires a valid DDMMMYYYY expiry");
  }

  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1]}`;
}

function canonicalStrike(strikePrice: number | string): string {
  if (typeof strikePrice === "number" && (!Number.isFinite(strikePrice) || strikePrice <= 0)) {
    throw new Error("option strike must be a positive finite number");
  }

  const decimal = typeof strikePrice === "number"
    ? strikePrice.toFixed(4)
    : strikePrice.trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/u.exec(decimal);
  if (!match) throw new Error("option strike must be compatible with numeric(18,4)");

  const integer = match[1].replace(/^0+(?=\d)/u, "");
  const fraction = (match[2] ?? "").padEnd(4, "0");
  if (integer.length > 14) throw new Error("option strike exceeds numeric(18,4) precision");
  if (BigInt(`${integer}${fraction}`) <= 0n) {
    throw new Error("option strike must be positive at numeric(18,4) precision");
  }
  return `${integer}.${fraction}`;
}

export function getOptionGreekKey(
  strikePrice: number | string,
  optionType: OptionType,
): string {
  return `${canonicalStrike(strikePrice)}:${optionType}`;
}

export function indexOptionContractsByGreekKey(
  contracts: CanonicalOptionContract[],
): Map<string, CanonicalOptionContract> {
  const contractsByGreekKey = new Map<string, CanonicalOptionContract>();
  for (const contract of contracts) {
    const key = getOptionGreekKey(contract.strikePrice, contract.optionType);
    if (contractsByGreekKey.has(key)) {
      throw new Error(`duplicate canonical option contract for ${key}`);
    }
    contractsByGreekKey.set(key, contract);
  }
  return contractsByGreekKey;
}

export function getOptionContractInsertValues(
  input: OptionContractSyncInput,
  lastSeenAt = new Date(),
): Array<typeof optionContracts.$inferInsert> {
  const underlying = input.underlying.trim().toUpperCase();
  if (!underlying) throw new Error("option contract underlying must not be empty");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.expiryDate)) {
    throw new Error("option contract expiry must use YYYY-MM-DD");
  }

  return input.contracts.map((contract) => ({
    provider: ANGELONE_PROVIDER,
    exchange: NFO_EXCHANGE,
    token: contract.token.trim(),
    tradingSymbol: contract.tradingSymbol.trim(),
    underlying,
    expiryDate: input.expiryDate,
    strikePrice: canonicalStrike(contract.strikePrice),
    optionType: contract.optionType,
    lotSize: contract.lotSize,
    instrumentType: contract.instrumentType,
    isActive: true,
    lastSeenAt,
  }));
}

export function getOptionContractConflictUpdateValues() {
  return {
    token: sql`excluded.token`,
    underlying: sql`excluded.underlying`,
    expiryDate: sql`excluded.expiry_date`,
    strikePrice: sql`excluded.strike_price`,
    optionType: sql`excluded.option_type`,
    lotSize: sql`excluded.lot_size`,
    instrumentType: sql`excluded.instrument_type`,
    isActive: sql`excluded.is_active`,
    lastSeenAt: sql`excluded.last_seen_at`,
  };
}

function compareCanonicalContracts(
  left: CanonicalOptionContract,
  right: CanonicalOptionContract,
): number {
  const leftStrike = BigInt(left.strikePrice.replace(".", ""));
  const rightStrike = BigInt(right.strikePrice.replace(".", ""));
  if (leftStrike !== rightStrike) return leftStrike < rightStrike ? -1 : 1;
  if (left.optionType !== right.optionType) return left.optionType === "CE" ? -1 : 1;
  const symbolDifference = left.tradingSymbol.localeCompare(right.tradingSymbol);
  return symbolDifference !== 0 ? symbolDifference : left.token.localeCompare(right.token);
}

export async function syncOptionContracts(
  input: OptionContractSyncInput,
): Promise<CanonicalOptionContract[]> {
  const rows = getOptionContractInsertValues(input);
  if (rows.length === 0) return [];

  const persistedContracts = await db
    .insert(optionContracts)
    .values(rows)
    .onConflictDoUpdate({
      target: [optionContracts.provider, optionContracts.exchange, optionContracts.tradingSymbol],
      set: getOptionContractConflictUpdateValues(),
    })
    .returning({
      id: optionContracts.id,
      token: optionContracts.token,
      tradingSymbol: optionContracts.tradingSymbol,
      strikePrice: optionContracts.strikePrice,
      optionType: optionContracts.optionType,
      instrumentType: optionContracts.instrumentType,
    });

  return persistedContracts.map((contract) => ({
    id: contract.id,
    token: contract.token,
    tradingSymbol: contract.tradingSymbol,
    strikePrice: canonicalStrike(contract.strikePrice),
    optionType: contract.optionType as OptionType,
    instrumentType: contract.instrumentType as InstrumentType,
  })).sort(compareCanonicalContracts);
}

const QUOTE_MARKET_FIELDS = [
  "ltp",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "openInterest",
  "netChange",
  "percentChange",
  "averagePrice",
  "totalBuyQuantity",
  "totalSellQuantity",
  "bestBidPrice",
  "bestBidQuantity",
  "bestAskPrice",
  "bestAskQuantity",
] as const satisfies ReadonlyArray<keyof AngelOneFullMarketQuote>;

export function hasOptionQuoteMarketContent(quote: AngelOneFullMarketQuote): boolean {
  return QUOTE_MARKET_FIELDS.some((field) => quote[field] !== undefined);
}

function optionalNumeric(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) throw new Error("option snapshot numeric field must be finite");
  return String(value);
}

function optionalQuantity(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("option snapshot quantity must be a non-negative safe integer");
  }
  return value;
}

function requiredTimestamp(value: string, fieldName: string): Date {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }
  return timestamp;
}

export function prepareOptionQuoteSnapshots(inputs: OptionQuoteSnapshotInput[]) {
  const rows: Array<typeof optionQuoteSnapshots.$inferInsert> = [];
  const unusableContractIds: string[] = [];

  for (const input of inputs) {
    if (!hasOptionQuoteMarketContent(input.quote)) {
      unusableContractIds.push(input.contractId);
      continue;
    }

    rows.push({
      contractId: input.contractId,
      ltp: optionalNumeric(input.quote.ltp),
      open: optionalNumeric(input.quote.open),
      high: optionalNumeric(input.quote.high),
      low: optionalNumeric(input.quote.low),
      close: optionalNumeric(input.quote.close),
      volume: optionalQuantity(input.quote.volume),
      openInterest: optionalQuantity(input.quote.openInterest),
      netChange: optionalNumeric(input.quote.netChange),
      percentChange: optionalNumeric(input.quote.percentChange),
      averagePrice: optionalNumeric(input.quote.averagePrice),
      totalBuyQuantity: optionalQuantity(input.quote.totalBuyQuantity),
      totalSellQuantity: optionalQuantity(input.quote.totalSellQuantity),
      bestBidPrice: optionalNumeric(input.quote.bestBidPrice),
      bestBidQuantity: optionalQuantity(input.quote.bestBidQuantity),
      bestAskPrice: optionalNumeric(input.quote.bestAskPrice),
      bestAskQuantity: optionalQuantity(input.quote.bestAskQuantity),
      exchangeFeedAt: requiredTimestamp(input.quote.exchangeFeedAt, "exchangeFeedAt"),
      exchangeTradeAt: input.quote.exchangeTradeAt === undefined
        ? null
        : requiredTimestamp(input.quote.exchangeTradeAt, "exchangeTradeAt"),
      source: ANGELONE_PROVIDER,
    });
  }

  return { rows, unusableContractIds };
}

export async function appendOptionQuoteSnapshots(
  inputs: OptionQuoteSnapshotInput[],
): Promise<OptionSnapshotWriteResult> {
  const prepared = prepareOptionQuoteSnapshots(inputs);
  if (prepared.rows.length === 0) {
    return {
      attempted: inputs.length,
      inserted: 0,
      duplicates: 0,
      unusable: prepared.unusableContractIds.length,
    };
  }

  const insertedSnapshots = await db
    .insert(optionQuoteSnapshots)
    .values(prepared.rows)
    .onConflictDoNothing({
      target: [optionQuoteSnapshots.contractId, optionQuoteSnapshots.exchangeFeedAt],
    })
    .returning({ id: optionQuoteSnapshots.id });

  return {
    attempted: inputs.length,
    inserted: insertedSnapshots.length,
    duplicates: prepared.rows.length - insertedSnapshots.length,
    unusable: prepared.unusableContractIds.length,
  };
}

export function hasOptionGreekMarketContent(greek: AngelOneOptionGreek): boolean {
  return greek.delta !== undefined
    || greek.gamma !== undefined
    || greek.theta !== undefined
    || greek.vega !== undefined
    || greek.impliedVolatility !== undefined
    || greek.tradeVolume !== undefined;
}

export function prepareOptionGreekSnapshots(
  inputs: OptionGreekSnapshotInput[],
  observedAt: Date,
) {
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("Greek observedAt must be a valid local observation time");
  }

  const rows: Array<typeof optionGreekSnapshots.$inferInsert> = [];
  const unusableContractIds: string[] = [];
  for (const input of inputs) {
    if (!hasOptionGreekMarketContent(input.greek)) {
      unusableContractIds.push(input.contractId);
      continue;
    }

    rows.push({
      contractId: input.contractId,
      delta: optionalNumeric(input.greek.delta),
      gamma: optionalNumeric(input.greek.gamma),
      theta: optionalNumeric(input.greek.theta),
      vega: optionalNumeric(input.greek.vega),
      impliedVolatility: optionalNumeric(input.greek.impliedVolatility),
      tradeVolume: optionalQuantity(input.greek.tradeVolume),
      observedAt,
      source: ANGELONE_PROVIDER,
    });
  }

  return { rows, unusableContractIds };
}

export async function appendOptionGreekSnapshots(
  inputs: OptionGreekSnapshotInput[],
  observedAt: Date,
): Promise<OptionSnapshotWriteResult> {
  const prepared = prepareOptionGreekSnapshots(inputs, observedAt);
  if (prepared.rows.length === 0) {
    return {
      attempted: inputs.length,
      inserted: 0,
      duplicates: 0,
      unusable: prepared.unusableContractIds.length,
    };
  }

  const insertedSnapshots = await db
    .insert(optionGreekSnapshots)
    .values(prepared.rows)
    .returning({ id: optionGreekSnapshots.id });

  return {
    attempted: inputs.length,
    inserted: insertedSnapshots.length,
    duplicates: 0,
    unusable: prepared.unusableContractIds.length,
  };
}
