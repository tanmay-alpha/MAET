import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orderSide = pgEnum("order_side", ["BUY", "SELL"]);
export const orderType = pgEnum("order_type", ["MARKET", "LIMIT", "SL", "SL-M"]);
export const orderStatus = pgEnum("order_status", ["pending", "partial", "filled", "cancelled", "rejected"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const brokers = pgTable("brokers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("angelone"),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("brokers_user_provider_unique").on(table.userId, table.provider)]);

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull(),
  side: orderSide("side").notNull(),
  type: orderType("type").notNull(),
  qty: integer("qty").notNull(),
  limitPrice: numeric("limit_price", { precision: 18, scale: 4 }),
  status: orderStatus("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  rejectReason: text("reject_reason"),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  filledAt: timestamp("filled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("orders_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  index("orders_user_placed_idx").on(table.userId, table.placedAt),
]);

export const fills = pgTable("fills", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull(),
  price: numeric("price", { precision: 18, scale: 4 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 4 }).notNull().default("0"),
  filledAt: timestamp("filled_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("fills_order_idx").on(table.orderId)]);

export const candles = pgTable("candles", {
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  open: numeric("open", { precision: 18, scale: 4 }).notNull(),
  high: numeric("high", { precision: 18, scale: 4 }).notNull(),
  low: numeric("low", { precision: 18, scale: 4 }).notNull(),
  close: numeric("close", { precision: 18, scale: 4 }).notNull(),
  volume: bigint("volume", { mode: "number" }).notNull().default(0),
  source: text("source").notNull().default("yahoo"),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.timeframe, table.ts] }),
  index("candles_symbol_ts_idx").on(table.symbol, table.ts),
]);

export const screenerRuns = pgTable("screener_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  criteria: jsonb("criteria").notNull(),
  matches: jsonb("matches").notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("screener_runs_user_idx").on(table.userId, table.startedAt)]);

export const backtestRuns = pgTable("backtest_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  strategy: text("strategy").notNull(),
  parameters: jsonb("parameters").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("backtest_runs_user_idx").on(table.userId, table.createdAt)]);

export const watchlist = pgTable("watchlist", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exchange: text("exchange").notNull().default("NSE"),
  symbol: text("symbol").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.exchange, table.symbol] })]);

export const idempotency = pgTable("idempotency", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  response: jsonb("response"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
  index("idempotency_expiry_idx").on(table.expiresAt),
]);

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull().default("NSE"),
  type: text("type").notNull(),
  condition: text("condition").notNull(),
  target: numeric("target", { precision: 18, scale: 4 }).notNull(),
  message: text("message"),
  triggered: boolean("triggered").notNull().default(false),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("alerts_user_idx").on(table.userId),
]);

// =============================================================================
// Company Master & Fundamentals Tables
// =============================================================================

export const companies = pgTable("companies", {
  id: text("id").primaryKey(), // symbol as ID for simplicity
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  isin: text("isin"),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: numeric("market_cap", { precision: 24, scale: 2 }),
  peRatio: numeric("pe_ratio", { precision: 8, scale: 4 }),
  pbRatio: numeric("pb_ratio", { precision: 8, scale: 4 }),
  roe: numeric("roe", { precision: 8, scale: 4 }),
  dividendYield: numeric("dividend_yield", { precision: 8, scale: 4 }),
  eps: numeric("eps", { precision: 8, scale: 4 }),
  debtToEquity: numeric("debt_to_equity", { precision: 8, scale: 4 }),
  faceValue: numeric("face_value", { precision: 8, scale: 4 }),
  isActive: boolean("is_active").default(true),
  lastFundamentalsUpdate: timestamp("last_fundamentals_update", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("companies_symbol_idx").on(table.symbol),
  index("companies_sector_idx").on(table.sector),
  index("companies_exchange_idx").on(table.exchange),
]);

export const fundamentals = pgTable("fundamentals", {
  id: text("id").primaryKey(), // year-quarter as ID
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodDate: timestamp("period_date", { withTimezone: true }).notNull(),
  periodType: text("period_type").notNull().default("quarterly"), // quarterly | annual
  peRatio: numeric("pe_ratio", { precision: 8, scale: 4 }),
  pbRatio: numeric("pb_ratio", { precision: 8, scale: 4 }),
  roe: numeric("roe", { precision: 8, scale: 4 }),
  marketCap: numeric("market_cap", { precision: 24, scale: 2 }),
  dividendYield: numeric("dividend_yield", { precision: 8, scale: 4 }),
  eps: numeric("eps", { precision: 8, scale: 4 }),
  debtToEquity: numeric("debt_to_equity", { precision: 8, scale: 4 }),
  revenue: numeric("revenue", { precision: 24, scale: 2 }),
  netIncome: numeric("net_income", { precision: 24, scale: 2 }),
  source: text("source").notNull().default("nse"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("fundamentals_company_idx").on(table.companyId, table.periodDate),
]);

