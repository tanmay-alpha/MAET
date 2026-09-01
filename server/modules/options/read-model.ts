import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import {
  optionContracts,
  optionGreekSnapshots,
  optionQuoteSnapshots,
} from "../../db/schema";
import type {
  GetLatestOptionChainInput,
  LatestOptionChainResponse,
  ListPersistedOptionExpiriesInput,
  OptionChainContractView,
  PersistedOptionExpiryView,
} from "./contracts";

const ANGELONE_PROVIDER = "angelone";
const NFO_EXCHANGE = "NFO";

type LatestOptionChainRow = {
  contractId: string;
  token: string;
  tradingSymbol: string;
  strikePrice: string;
  optionType: "CE" | "PE";
  lotSize: number;
  instrumentType: string;
  quoteLtp: string | null;
  quoteOpen: string | null;
  quoteHigh: string | null;
  quoteLow: string | null;
  quoteClose: string | null;
  quoteVolume: number | null;
  quoteOpenInterest: number | null;
  quoteNetChange: string | null;
  quotePercentChange: string | null;
  quoteAveragePrice: string | null;
  quoteTotalBuyQuantity: number | null;
  quoteTotalSellQuantity: number | null;
  quoteBestBidPrice: string | null;
  quoteBestBidQuantity: number | null;
  quoteBestAskPrice: string | null;
  quoteBestAskQuantity: number | null;
  quoteExchangeFeedAt: Date | null;
  quoteExchangeTradeAt: Date | null;
  quoteReceivedAt: Date | null;
  quoteSource: string | null;
  greekDelta: string | null;
  greekGamma: string | null;
  greekTheta: string | null;
  greekVega: string | null;
  greekImpliedVolatility: string | null;
  greekTradeVolume: number | null;
  greekObservedAt: Date | null;
  greekSource: string | null;
};

export function normalizePersistedOptionUnderlying(underlying: string): string {
  const normalized = underlying.trim().toUpperCase();
  if (!normalized) throw new Error("option-chain underlying must not be empty");
  if (normalized.length > 32) throw new Error("option-chain underlying exceeds 32 characters");
  return normalized;
}

export function normalizePersistedOptionExpiryDate(expiryDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(expiryDate);
  if (!match) throw new Error("option-chain expiryDate must use YYYY-MM-DD");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validationDate = new Date(0);
  validationDate.setUTCHours(0, 0, 0, 0);
  validationDate.setUTCFullYear(year, month - 1, day);
  if (
    validationDate.getUTCFullYear() !== year
    || validationDate.getUTCMonth() !== month - 1
    || validationDate.getUTCDate() !== day
  ) {
    throw new Error("option-chain expiryDate must use YYYY-MM-DD");
  }

  return expiryDate;
}

function comparableStrike(strikePrice: string): bigint {
  const [whole, fraction = ""] = strikePrice.split(".");
  return BigInt(`${whole}${fraction.padEnd(4, "0")}`);
}

function compareContracts(left: OptionChainContractView, right: OptionChainContractView): number {
  const leftStrike = comparableStrike(left.strikePrice);
  const rightStrike = comparableStrike(right.strikePrice);
  if (leftStrike !== rightStrike) return leftStrike < rightStrike ? -1 : 1;
  if (left.optionType !== right.optionType) return left.optionType === "CE" ? -1 : 1;
  const symbolDifference = left.tradingSymbol.localeCompare(right.tradingSymbol);
  return symbolDifference !== 0 ? symbolDifference : left.token.localeCompare(right.token);
}

function timestampRange(timestamps: Array<string | null>) {
  const known = timestamps.filter((timestamp): timestamp is string => timestamp !== null).sort();
  return {
    oldest: known[0] ?? null,
    newest: known.at(-1) ?? null,
  };
}

export function createLatestOptionChainResponse(input: {
  underlying: string;
  expiryDate: string;
  contracts: OptionChainContractView[];
}): LatestOptionChainResponse {
  const contracts = [...input.contracts].sort(compareContracts);
  const quoteRange = timestampRange(contracts.map((contract) => contract.quote?.exchangeFeedAt ?? null));
  const greekRange = timestampRange(contracts.map((contract) => contract.greeks?.observedAt ?? null));

  return {
    underlying: normalizePersistedOptionUnderlying(input.underlying),
    expiryDate: normalizePersistedOptionExpiryDate(input.expiryDate),
    contracts,
    coverage: {
      contracts: contracts.length,
      quotes: contracts.filter((contract) => contract.quote !== null).length,
      greeks: contracts.filter((contract) => contract.greeks !== null).length,
    },
    freshness: {
      oldestQuoteAt: quoteRange.oldest,
      newestQuoteAt: quoteRange.newest,
      oldestGreekObservedAt: greekRange.oldest,
      newestGreekObservedAt: greekRange.newest,
    },
  };
}

export function sortPersistedOptionExpiries(
  expiries: PersistedOptionExpiryView[],
): PersistedOptionExpiryView[] {
  return [...expiries].sort((left, right) => left.expiryDate.localeCompare(right.expiryDate));
}

function toOptionChainContractView(row: LatestOptionChainRow): OptionChainContractView {
  const quote = row.quoteExchangeFeedAt === null
    ? null
    : (() => {
      if (row.quoteReceivedAt === null || row.quoteSource === null) {
        throw new Error(`option quote snapshot for ${row.contractId} is incomplete`);
      }
      return {
        ltp: row.quoteLtp,
        open: row.quoteOpen,
        high: row.quoteHigh,
        low: row.quoteLow,
        close: row.quoteClose,
        volume: row.quoteVolume,
        openInterest: row.quoteOpenInterest,
        netChange: row.quoteNetChange,
        percentChange: row.quotePercentChange,
        averagePrice: row.quoteAveragePrice,
        totalBuyQuantity: row.quoteTotalBuyQuantity,
        totalSellQuantity: row.quoteTotalSellQuantity,
        bestBidPrice: row.quoteBestBidPrice,
        bestBidQuantity: row.quoteBestBidQuantity,
        bestAskPrice: row.quoteBestAskPrice,
        bestAskQuantity: row.quoteBestAskQuantity,
        exchangeFeedAt: row.quoteExchangeFeedAt.toISOString(),
        exchangeTradeAt: row.quoteExchangeTradeAt?.toISOString() ?? null,
        receivedAt: row.quoteReceivedAt.toISOString(),
        source: row.quoteSource,
      };
    })();
  const greeks = row.greekObservedAt === null
    ? null
    : (() => {
      if (row.greekSource === null) {
        throw new Error(`option Greek snapshot for ${row.contractId} is incomplete`);
      }
      return {
        delta: row.greekDelta,
        gamma: row.greekGamma,
        theta: row.greekTheta,
        vega: row.greekVega,
        impliedVolatility: row.greekImpliedVolatility,
        tradeVolume: row.greekTradeVolume,
        observedAt: row.greekObservedAt.toISOString(),
        source: row.greekSource,
      };
    })();

  return {
    contractId: row.contractId,
    token: row.token,
    tradingSymbol: row.tradingSymbol,
    strikePrice: row.strikePrice,
    optionType: row.optionType,
    lotSize: row.lotSize,
    instrumentType: row.instrumentType,
    quote,
    greeks,
  };
}

export async function getLatestPersistedOptionChain(
  input: GetLatestOptionChainInput,
): Promise<LatestOptionChainResponse> {
  const underlying = normalizePersistedOptionUnderlying(input.underlying);
  const expiryDate = normalizePersistedOptionExpiryDate(input.expiryDate);
  const latestQuote = db
    .select({
      ltp: optionQuoteSnapshots.ltp,
      open: optionQuoteSnapshots.open,
      high: optionQuoteSnapshots.high,
      low: optionQuoteSnapshots.low,
      close: optionQuoteSnapshots.close,
      volume: optionQuoteSnapshots.volume,
      openInterest: optionQuoteSnapshots.openInterest,
      netChange: optionQuoteSnapshots.netChange,
      percentChange: optionQuoteSnapshots.percentChange,
      averagePrice: optionQuoteSnapshots.averagePrice,
      totalBuyQuantity: optionQuoteSnapshots.totalBuyQuantity,
      totalSellQuantity: optionQuoteSnapshots.totalSellQuantity,
      bestBidPrice: optionQuoteSnapshots.bestBidPrice,
      bestBidQuantity: optionQuoteSnapshots.bestBidQuantity,
      bestAskPrice: optionQuoteSnapshots.bestAskPrice,
      bestAskQuantity: optionQuoteSnapshots.bestAskQuantity,
      exchangeFeedAt: optionQuoteSnapshots.exchangeFeedAt,
      exchangeTradeAt: optionQuoteSnapshots.exchangeTradeAt,
      receivedAt: optionQuoteSnapshots.receivedAt,
      source: optionQuoteSnapshots.source,
    })
    .from(optionQuoteSnapshots)
    .where(eq(optionQuoteSnapshots.contractId, optionContracts.id))
    .orderBy(desc(optionQuoteSnapshots.exchangeFeedAt), desc(optionQuoteSnapshots.id))
    .limit(1)
    .as("latest_quote");
  const latestGreek = db
    .select({
      delta: optionGreekSnapshots.delta,
      gamma: optionGreekSnapshots.gamma,
      theta: optionGreekSnapshots.theta,
      vega: optionGreekSnapshots.vega,
      impliedVolatility: optionGreekSnapshots.impliedVolatility,
      tradeVolume: optionGreekSnapshots.tradeVolume,
      observedAt: optionGreekSnapshots.observedAt,
      source: optionGreekSnapshots.source,
    })
    .from(optionGreekSnapshots)
    .where(eq(optionGreekSnapshots.contractId, optionContracts.id))
    .orderBy(desc(optionGreekSnapshots.observedAt), desc(optionGreekSnapshots.id))
    .limit(1)
    .as("latest_greek");

  const rows = await db
    .select({
      contractId: optionContracts.id,
      token: optionContracts.token,
      tradingSymbol: optionContracts.tradingSymbol,
      strikePrice: optionContracts.strikePrice,
      optionType: optionContracts.optionType,
      lotSize: optionContracts.lotSize,
      instrumentType: optionContracts.instrumentType,
      quoteLtp: latestQuote.ltp,
      quoteOpen: latestQuote.open,
      quoteHigh: latestQuote.high,
      quoteLow: latestQuote.low,
      quoteClose: latestQuote.close,
      quoteVolume: latestQuote.volume,
      quoteOpenInterest: latestQuote.openInterest,
      quoteNetChange: latestQuote.netChange,
      quotePercentChange: latestQuote.percentChange,
      quoteAveragePrice: latestQuote.averagePrice,
      quoteTotalBuyQuantity: latestQuote.totalBuyQuantity,
      quoteTotalSellQuantity: latestQuote.totalSellQuantity,
      quoteBestBidPrice: latestQuote.bestBidPrice,
      quoteBestBidQuantity: latestQuote.bestBidQuantity,
      quoteBestAskPrice: latestQuote.bestAskPrice,
      quoteBestAskQuantity: latestQuote.bestAskQuantity,
      quoteExchangeFeedAt: latestQuote.exchangeFeedAt,
      quoteExchangeTradeAt: latestQuote.exchangeTradeAt,
      quoteReceivedAt: latestQuote.receivedAt,
      quoteSource: latestQuote.source,
      greekDelta: latestGreek.delta,
      greekGamma: latestGreek.gamma,
      greekTheta: latestGreek.theta,
      greekVega: latestGreek.vega,
      greekImpliedVolatility: latestGreek.impliedVolatility,
      greekTradeVolume: latestGreek.tradeVolume,
      greekObservedAt: latestGreek.observedAt,
      greekSource: latestGreek.source,
    })
    .from(optionContracts)
    .leftJoinLateral(latestQuote, sql`true`)
    .leftJoinLateral(latestGreek, sql`true`)
    .where(and(
      eq(optionContracts.provider, ANGELONE_PROVIDER),
      eq(optionContracts.exchange, NFO_EXCHANGE),
      eq(optionContracts.underlying, underlying),
      eq(optionContracts.expiryDate, expiryDate),
    ))
    .orderBy(asc(optionContracts.strikePrice), asc(optionContracts.optionType), asc(optionContracts.tradingSymbol));

  return createLatestOptionChainResponse({
    underlying,
    expiryDate,
    contracts: (rows as LatestOptionChainRow[]).map(toOptionChainContractView),
  });
}

export async function listPersistedOptionExpiries(
  input: ListPersistedOptionExpiriesInput,
): Promise<PersistedOptionExpiryView[]> {
  const underlying = normalizePersistedOptionUnderlying(input.underlying);
  const rows = await db
    .select({
      expiryDate: optionContracts.expiryDate,
      contractCount: sql<number>`count(${optionContracts.id})::int`,
      latestQuoteAt: sql<Date | null>`max(${optionQuoteSnapshots.exchangeFeedAt})`,
    })
    .from(optionContracts)
    .leftJoin(optionQuoteSnapshots, eq(optionQuoteSnapshots.contractId, optionContracts.id))
    .where(and(
      eq(optionContracts.provider, ANGELONE_PROVIDER),
      eq(optionContracts.exchange, NFO_EXCHANGE),
      eq(optionContracts.underlying, underlying),
    ))
    .groupBy(optionContracts.expiryDate)
    .orderBy(asc(optionContracts.expiryDate));

  return sortPersistedOptionExpiries(rows.map((row) => ({
    expiryDate: row.expiryDate,
    contractCount: row.contractCount,
    latestQuoteAt: row.latestQuoteAt?.toISOString() ?? null,
  })));
}
