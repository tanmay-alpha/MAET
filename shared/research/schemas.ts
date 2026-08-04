import { z } from "zod";

export const LayoutTypeSchema = z.enum(["SINGLE", "VERTICAL_2", "HORIZONTAL_2", "GRID_4"]);
export type LayoutType = z.infer<typeof LayoutTypeSchema>;

export const ChartTypeSchema = z.enum(["CANDLE", "LINE"]);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const DrawingTypeSchema = z.enum([
  "TREND_LINE",
  "HORIZONTAL_LINE",
  "VERTICAL_LINE",
  "RAY",
  "RECTANGLE",
  "FIBONACCI_RETRACEMENT",
  "TEXT_NOTE",
  "RISK_REWARD",
]);
export type DrawingType = z.infer<typeof DrawingTypeSchema>;

export const DrawingPointSchema = z.object({
  time: z.number(),
  price: z.number(),
  x: z.number().optional(),
  y: z.number().optional(),
});
export type DrawingPoint = z.infer<typeof DrawingPointSchema>;

export const ChartDrawingSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
  paneId: z.string().optional(),
  symbol: z.string().min(1),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  timeframeScope: z.string().optional(),
  drawingType: DrawingTypeSchema,
  points: z.array(DrawingPointSchema).min(1),
  style: z.record(z.any()).default({}),
  label: z.string().optional(),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  schemaVersion: z.number().int().default(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ChartDrawing = z.infer<typeof ChartDrawingSchema>;

export const IndicatorInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["SMA", "EMA", "BOLLINGER_BANDS", "VWAP", "SUPERTREND", "VOLUME", "RSI", "MACD", "ATR", "OBV"]),
  pane: z.enum(["main", "subpanel"]).default("main"),
  parameters: z.record(z.any()).default({}),
  style: z.object({ color: z.string(), lineWidth: z.number().optional() }).default({ color: "#3b82f6" }),
  visible: z.boolean().default(true),
});
export type IndicatorInstance = z.infer<typeof IndicatorInstanceSchema>;

export const IndicatorTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  indicators: z.array(IndicatorInstanceSchema),
  isDefault: z.boolean().default(false),
  schemaVersion: z.number().int().default(1),
});
export type IndicatorTemplate = z.infer<typeof IndicatorTemplateSchema>;

export const ChartPaneSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
  paneKey: z.string().min(1),
  symbol: z.string().min(1),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]).default("5m"),
  chartType: ChartTypeSchema.default("CANDLE"),
  position: z.number().int().min(0).default(0),
  indicators: z.array(IndicatorInstanceSchema).default([]),
  drawings: z.array(ChartDrawingSchema).default([]),
  settings: z.record(z.any()).default({}),
});
export type ChartPane = z.infer<typeof ChartPaneSchema>;

export const ChartWorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  layoutType: LayoutTypeSchema.default("SINGLE"),
  activeSymbol: z.string().min(1).default("RELIANCE"),
  activeExchange: z.enum(["NSE", "BSE"]).default("NSE"),
  isDefault: z.boolean().default(false),
  schemaVersion: z.number().int().default(1),
  panes: z.array(ChartPaneSchema).default([]),
  settings: z.record(z.any()).default({}),
});
export type ChartWorkspace = z.infer<typeof ChartWorkspaceSchema>;

export const ThesisDirectionSchema = z.enum(["LONG", "SHORT", "WATCH"]);
export type ThesisDirection = z.infer<typeof ThesisDirectionSchema>;

export const ThesisStatusSchema = z.enum(["DRAFT", "PLANNED", "ACTIVE", "CLOSED", "INVALIDATED", "ARCHIVED"]);
export type ThesisStatus = z.infer<typeof ThesisStatusSchema>;

export const TradeThesisSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  symbol: z.string().min(1),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  screenerRunId: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
  title: z.string().min(1).max(120),
  setupType: z.string().min(1),
  direction: ThesisDirectionSchema,
  hypothesis: z.string().min(1),
  entryPlan: z.string().optional(),
  stopPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
  riskAmount: z.number().nonnegative().optional(),
  riskPercent: z.number().nonnegative().optional(),
  status: ThesisStatusSchema.default("DRAFT"),
  schemaVersion: z.number().int().default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().optional(),
});
export type TradeThesis = z.infer<typeof TradeThesisSchema>;

export const TradeReviewOutcomeSchema = z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN", "CANCELLED", "INVALIDATED"]);
export type TradeReviewOutcome = z.infer<typeof TradeReviewOutcomeSchema>;

export const TradeReviewSchema = z.object({
  id: z.string().uuid(),
  thesisId: z.string().uuid(),
  userId: z.string().uuid(),
  outcome: TradeReviewOutcomeSchema,
  reviewText: z.string(),
  plannedEntry: z.number().positive().optional(),
  averageEntry: z.number().positive().optional(),
  plannedStop: z.number().positive().optional(),
  plannedTarget: z.number().positive().optional(),
  realizedPnl: z.number(),
  returnPercent: z.number(),
  holdingDurationSeconds: z.number().nonnegative().optional(),
  ruleFollowed: z.boolean().default(true),
  mistakes: z.string().optional(),
  lessons: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TradeReview = z.infer<typeof TradeReviewSchema>;
