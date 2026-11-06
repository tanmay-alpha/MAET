/**
 * Deterministic fixture data for the e2e suite. Every shape mirrors a real backend
 * contract: MarketCompaniesResponse / CompanyDetailResponse / MarketCandlesResponse /
 * QuotesPayload (src/lib/market-api.ts, shared/types/market.ts) and the Drizzle rows
 * behind PaperTradingState (server/modules/paper-trading/contracts.ts), serialized the
 * way JSON carries them: numeric columns as strings, timestamps as ISO strings.
 */
import type { MarketCandle, MarketCompany } from "../../../src/lib/market-api";
import type {
  PaperAccountRow,
  PaperOrderRow,
} from "../../../server/modules/paper-trading/contracts";

/** A Drizzle row as it crosses the tRPC JSON boundary: Date columns become ISO strings. */
type Wire<Row> = {
  [K in keyof Row]: Exclude<Row[K], null> extends Date
    ? null extends Row[K]
      ? string | null
      : string
    : Row[K];
};
export type PaperAccountWire = Wire<PaperAccountRow>;
export type PaperOrderWire = Wire<PaperOrderRow>;

export const FIXED_NOW = "2026-11-06T10:15:00.000Z";
export const USER_ID = "7d7f0f7e-1c1f-4a52-9a4c-0f3b7c1e2a01";
export const ACCESS_TOKEN = "e2e-access-token";

// ── Companies (screener) ────────────────────────────────────────────────────

type CompanyFixture = Pick<
  MarketCompany,
  | "symbol"
  | "name"
  | "isin"
  | "sector"
  | "industry"
  | "marketCap"
  | "marketCapBucket"
  | "price"
  | "changePct"
  | "volume"
  | "pe"
>;

const COMPANY_ROWS: CompanyFixture[] = [
  {
    symbol: "HDFCBANK",
    name: "HDFC Bank Limited",
    isin: "INE040A01034",
    sector: "Financial Services",
    industry: "Banks",
    marketCap: 1_250_000_00_00_000,
    marketCapBucket: "large",
    price: 1650.4,
    changePct: -0.42,
    volume: 8_200_000,
    pe: 19.1,
  },
  {
    symbol: "INFY",
    name: "Infosys Limited",
    isin: "INE009A01021",
    sector: "Technology",
    industry: "Software",
    marketCap: 610_000_00_00_000,
    marketCapBucket: "large",
    price: 1475.1,
    changePct: 1.12,
    volume: 5_100_000,
    pe: 24.3,
  },
  {
    symbol: "KPITTECH",
    name: "KPIT Technologies Limited",
    isin: "INE04I401011",
    sector: "Technology",
    industry: "Software",
    marketCap: 38_000_00_00_000,
    marketCapBucket: "mid",
    price: 1390.25,
    changePct: 2.4,
    volume: 1_400_000,
    pe: 61.7,
  },
  {
    symbol: "RELIANCE",
    name: "Reliance Industries Limited",
    isin: "INE002A01018",
    sector: "Energy",
    industry: "Refineries",
    marketCap: 1_660_000_00_00_000,
    marketCapBucket: "large",
    price: 2450,
    changePct: 2.08,
    volume: 6_300_000,
    pe: 27.9,
  },
  {
    symbol: "TATAELXSI",
    name: "Tata Elxsi Limited",
    isin: "INE670A01012",
    sector: "Technology",
    industry: "Software",
    marketCap: 42_000_00_00_000,
    marketCapBucket: "mid",
    price: 6745.8,
    changePct: -1.05,
    volume: 310_000,
    pe: 55.2,
  },
  {
    symbol: "TCS",
    name: "Tata Consultancy Services Limited",
    isin: "INE467B01029",
    sector: "Technology",
    industry: "Software",
    marketCap: 1_400_000_00_00_000,
    marketCapBucket: "large",
    price: 3890.55,
    changePct: 0.35,
    volume: 2_700_000,
    pe: 29.4,
  },
];

export const COMPANIES: MarketCompany[] = COMPANY_ROWS.map((row) => ({
  ...row,
  exchange: "NSE",
  series: "EQ",
  source: "database",
  quoteAsOf: FIXED_NOW,
  fundamentalsAsOf: "2026-11-05T00:00:00.000Z",
  quoteSource: "angelone",
  fundamentalsSource: "Stored database snapshot",
}));

// Mirrors server/domain/screener/company-query.ts fieldAvailability() for the fields present.
export const FIELD_AVAILABILITY = Object.fromEntries(
  ["identity", "isin", "sector", "industry", "price", "changePct", "volume", "marketCap", "pe"].map(
    (field) => [field, { available: true, source: "Stored database snapshot" }],
  ),
);

// ── Candles ─────────────────────────────────────────────────────────────────

const TF_STEP_MS: Record<MarketCandle["tf"], number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
  "1wk": 7 * 86_400_000,
};
const TF_BASE: Record<MarketCandle["tf"], number> = {
  "1m": 2440,
  "5m": 2400,
  "15m": 2380,
  "1h": 2350,
  "1d": 2300,
  "1wk": 2100,
};

/** 60 deterministic candles per (symbol, timeframe); each timeframe has a distinct price level. */
export function candlesFor(symbol: string, tf: MarketCandle["tf"]): MarketCandle[] {
  const end = Date.parse("2026-11-05T09:45:00.000Z");
  const step = TF_STEP_MS[tf];
  const base = TF_BASE[tf] + (symbol === "RELIANCE" ? 0 : 500);
  return Array.from({ length: 60 }, (_, i) => {
    const open = base + i * 1.5;
    const close = open + (i % 3 === 0 ? -2.25 : 3.75);
    return {
      symbol,
      tf,
      ts: new Date(end - (59 - i) * step).toISOString(),
      open,
      high: Math.max(open, close) + 4.1,
      low: Math.min(open, close) - 3.3,
      close,
      volume: 100_000 + i * 1_250,
    };
  });
}

// ── Quotes ──────────────────────────────────────────────────────────────────

export const BASE_PRICES: Record<string, number> = {
  NIFTY50: 24125.4,
  BANKNIFTY: 52310.15,
  SENSEX: 79540.2,
  NIFTYIT: 41020.75,
  NIFTYFMCG: 56780.3,
  INDIAVIX: 13.42,
  RELIANCE: 2450,
  TCS: 3890.55,
  HDFCBANK: 1650.4,
  INFY: 1475.1,
  ICICIBANK: 1260.35,
  BHARTIARTL: 1588.2,
  ITC: 468.9,
  LT: 3620.45,
  SBIN: 822.6,
  AXISBANK: 1144.75,
  MARUTI: 12480.1,
  HINDUNILVR: 2390.65,
  KPITTECH: 1390.25,
  TATAELXSI: 6745.8,
};

export type MarketSession = "open" | "closed";

/** One quote as GET /api/market/quotes serves it (shared/types/market.ts MarketQuote). */
export function quoteFor(
  symbol: string,
  session: MarketSession,
  price = BASE_PRICES[symbol] ?? 1000,
) {
  const previousClose = Math.round(price * 0.98 * 100) / 100;
  const change = Math.round((price - previousClose) * 100) / 100;
  const live = session === "open";
  return {
    exchange: "NSE" as const,
    symbol,
    price,
    volume: 1_000_000,
    ts: live ? FIXED_NOW : "2026-11-05T10:00:00.000Z",
    source: live ? ("angelone" as const) : ("yahoo" as const),
    quality: live ? ("live" as const) : ("delayed" as const),
    previousClose,
    change,
    changePct: Math.round((change / previousClose) * 10_000) / 100,
    delayed: !live,
  };
}

// ── Paper trading rows ──────────────────────────────────────────────────────

export function paperAccountRow(): PaperAccountWire {
  return {
    userId: USER_ID,
    cashBalance: "1000000.0000",
    allocatedMargin: "0.0000",
    maintenanceMargin: "0.0000",
    leverageFactor: 5,
    liquidationThreshold: "0.1000",
    isLocked: false,
    createdAt: "2026-10-01T04:00:00.000Z",
    updatedAt: FIXED_NOW,
    initialCash: "1000000.0000",
    realisedPnl: "0.0000",
    status: "ACTIVE" as const,
    lockReason: null,
    lockedAt: null,
    liquidationCompletedAt: null,
    generation: 1,
    version: 1,
    currency: "INR",
    lastEquity: "1000000.0000",
    lastValuedAt: FIXED_NOW,
    resetAt: null,
  };
}

/** A resting order exactly as the service persists it (server/db/schema.ts paperOrders). */
export function paperOrderRow(input: {
  id: string;
  type: "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT";
  symbol: string;
  exchange: string;
  side: "BUY" | "SELL";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  clientOrderId: string;
  idempotencyKey: string;
}): PaperOrderWire {
  const money = (value: number | undefined) => (value === undefined ? null : value.toFixed(4));
  return {
    id: input.id,
    userId: USER_ID,
    parentOrderId: null,
    symbol: input.symbol,
    exchange: input.exchange,
    side: input.side,
    type: input.type,
    status: input.type === "STOP_LOSS_LIMIT" ? "TRIGGER_PENDING" : "PENDING",
    executionType: "GOOD_TILL_CANCELLED" as const,
    qty: input.quantity,
    limitPrice: money(input.limitPrice),
    stopPrice: money(input.stopPrice),
    stopLossPrice: null,
    takeProfitPrice: null,
    filledQty: 0,
    averageFillPrice: null,
    slippageApplied: "0.0000",
    transactionFee: "0.0000",
    rejectReason: null,
    trailingDistance: null,
    trailingHwm: null,
    trailingLwm: null,
    isTrailingPercent: false,
    placedAt: FIXED_NOW,
    filledAt: null,
    updatedAt: FIXED_NOW,
    clientOrderId: input.clientOrderId,
    idempotencyKey: input.idempotencyKey,
    generation: 1,
    triggeredAt: null,
    cancelledAt: null,
    lastFillAt: null,
    quoteSource: "angelone",
    quoteQuality: "live",
    quoteTimestamp: FIXED_NOW,
    referencePrice: "2450.0000",
    lastQuoteFingerprint: null,
    version: 1,
  };
}

// ── Strategy definitions ────────────────────────────────────────────────────

export const CREATED_STRATEGY_ID = "11111111-1111-4111-8111-111111111111";
