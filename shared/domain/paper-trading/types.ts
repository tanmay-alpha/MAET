import { z } from "zod";
import {
  ExchangeSchema,
  ExecutionQuoteSchema,
  MarketDataQualitySchema,
  MarketDataSourceSchema,
} from "../../types/market";

export const PaperAccountStatusSchema = z.enum([
  "ACTIVE",
  "LIQUIDATION_PENDING",
  "LIQUIDATED",
]);
export type PaperAccountStatus = z.infer<typeof PaperAccountStatusSchema>;

export const PaperOrderSideSchema = z.enum(["BUY", "SELL"]);
export type PaperOrderSide = z.infer<typeof PaperOrderSideSchema>;

export const PaperOrderTypeSchema = z.enum([
  "MARKET",
  "LIMIT",
  "STOP_LOSS_LIMIT",
]);
export type PaperOrderType = z.infer<typeof PaperOrderTypeSchema>;

export const PaperOrderStatusSchema = z.enum([
  "PENDING",
  "TRIGGERED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
]);
export type PaperOrderStatus = z.infer<typeof PaperOrderStatusSchema>;

export const PaperExecutionReasonSchema = z.enum([
  "USER_ORDER",
  "STOP_TRIGGER",
  "TRAILING_STOP",
  "MARGIN_LIQUIDATION",
]);
export type PaperExecutionReason = z.infer<
  typeof PaperExecutionReasonSchema
>;

const PositiveQuantitySchema = z
  .number()
  .int("Quantity must be a positive whole number")
  .positive("Quantity must be a positive whole number");

const OptionalPositivePriceSchema = z.number().finite().positive().optional();
const IsoDateSchema = z.string().datetime();

export const PaperPositionSchema = z
  .object({
    symbol: z.string().trim().min(1),
    quantity: z.number().finite().refine((value) => value !== 0, {
      message: "Position quantity cannot be zero",
    }),
    averagePrice: z.number().finite().positive(),
    marginLocked: z.number().finite().nonnegative(),
    realisedPnl: z.number().finite(),
    unrealisedPnl: z.number().finite(),
    updatedAt: IsoDateSchema,
  })
  .strict();
export type PaperPosition = z.infer<typeof PaperPositionSchema>;

export const PaperFillSchema = z
  .object({
    id: z.string().min(1),
    orderId: z.string().min(1),
    symbol: z.string().trim().min(1),
    side: PaperOrderSideSchema,
    quantity: PositiveQuantitySchema,
    referencePrice: z.number().finite().positive(),
    fillPrice: z.number().finite().positive(),
    slippage: z.number().finite().nonnegative(),
    fees: z.number().finite().nonnegative(),
    realisedPnl: z.number().finite(),
    quoteSource: MarketDataSourceSchema,
    quoteQuality: MarketDataQualitySchema,
    quoteTimestamp: IsoDateSchema,
    exchange: ExchangeSchema,
    reason: PaperExecutionReasonSchema,
    executedAt: IsoDateSchema,
  })
  .strict();
export type PaperFill = z.infer<typeof PaperFillSchema>;

export const PaperOrderSchema = z
  .object({
    id: z.string().min(1),
    symbol: z.string().trim().min(1),
    side: PaperOrderSideSchema,
    quantity: PositiveQuantitySchema,
    type: PaperOrderTypeSchema,
    status: PaperOrderStatusSchema,
    limitPrice: OptionalPositivePriceSchema,
    stopPrice: OptionalPositivePriceSchema,
    triggeredAt: IsoDateSchema.optional(),
    filledQuantity: z.number().int().nonnegative(),
    averageFillPrice: OptionalPositivePriceSchema,
    stopLossPrice: OptionalPositivePriceSchema,
    takeProfitPrice: OptionalPositivePriceSchema,
    trailingDistance: OptionalPositivePriceSchema,
    trailingHighWatermark: OptionalPositivePriceSchema,
    trailingLowWatermark: OptionalPositivePriceSchema,
    trailingIsPercent: z.boolean().optional(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    rejectionReason: z.string().optional(),
    parentOrderId: z.string().min(1).optional(),
    quoteSource: MarketDataSourceSchema.optional(),
    quoteQuality: MarketDataQualitySchema.optional(),
    quoteTimestamp: IsoDateSchema.optional(),
    referencePrice: OptionalPositivePriceSchema,
  })
  .strict()
  .superRefine((order, context) => {
    if (order.filledQuantity > order.quantity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filledQuantity"],
        message: "Filled quantity cannot exceed order quantity",
      });
    }
    if (
      (order.type === "LIMIT" || order.type === "STOP_LOSS_LIMIT") &&
      order.limitPrice === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limitPrice"],
        message: "Limit price is required",
      });
    }
    if (order.type === "STOP_LOSS_LIMIT" && order.stopPrice === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stopPrice"],
        message: "Stop price is required",
      });
    }
  });
export type PaperOrder = z.infer<typeof PaperOrderSchema>;

export const PaperAccountV3Schema = z
  .object({
    version: z.literal(3),
    initialCash: z.number().finite().positive(),
    cash: z.number().finite(),
    allocatedMargin: z.number().finite().nonnegative(),
    maintenanceMargin: z.number().finite().nonnegative(),
    realisedPnl: z.number().finite(),
    status: PaperAccountStatusSchema,
    lockReason: z.string().optional(),
    lockedAt: IsoDateSchema.optional(),
    liquidationCompletedAt: IsoDateSchema.optional(),
    positions: z.array(PaperPositionSchema),
    orders: z.array(PaperOrderSchema),
    fills: z.array(PaperFillSchema),
  })
  .strict();
export type PaperAccount = z.infer<typeof PaperAccountV3Schema>;

const PaperOrderBaseShape = {
  symbol: z.string().trim().min(1, "Select a symbol").transform((value) =>
    value.toUpperCase()
  ),
  side: PaperOrderSideSchema,
  quantity: PositiveQuantitySchema,
};

export const PlacePaperMarketOrderSchema = z
  .object({
    ...PaperOrderBaseShape,
    type: z.literal("MARKET"),
    quote: ExecutionQuoteSchema,
    stopLossPrice: OptionalPositivePriceSchema,
    takeProfitPrice: OptionalPositivePriceSchema,
    trailingDistance: OptionalPositivePriceSchema,
    trailingIsPercent: z.boolean().optional(),
  })
  .strict();

export const PlacePaperLimitOrderSchema = z
  .object({
    ...PaperOrderBaseShape,
    type: z.literal("LIMIT"),
    limitPrice: z.number().finite().positive("Enter a valid limit price"),
    stopLossPrice: OptionalPositivePriceSchema,
    takeProfitPrice: OptionalPositivePriceSchema,
  })
  .strict();

export const PlacePaperStopLimitOrderSchema = z
  .object({
    ...PaperOrderBaseShape,
    type: z.literal("STOP_LOSS_LIMIT"),
    stopPrice: z.number().finite().positive("Enter a valid stop price"),
    limitPrice: z.number().finite().positive("Enter a valid limit price"),
  })
  .strict();

export const PlacePaperOrderSchema = z.discriminatedUnion("type", [
  PlacePaperMarketOrderSchema,
  PlacePaperLimitOrderSchema,
  PlacePaperStopLimitOrderSchema,
]);

export type PlacePaperMarketOrder = z.infer<
  typeof PlacePaperMarketOrderSchema
>;
export type PlacePaperLimitOrder = z.infer<
  typeof PlacePaperLimitOrderSchema
>;
export type PlacePaperStopLimitOrder = z.infer<
  typeof PlacePaperStopLimitOrderSchema
>;
export type PlacePaperOrder = z.infer<typeof PlacePaperOrderSchema>;

export function formatValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid order input";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

const LegacyFiniteNumberSchema = z.number().finite();

export const LegacyPaperPositionSchema = z
  .object({
    symbol: z.string().trim().min(1),
    quantity: LegacyFiniteNumberSchema.optional(),
    qty: LegacyFiniteNumberSchema.optional(),
    averagePrice: LegacyFiniteNumberSchema.optional(),
    avgPrice: LegacyFiniteNumberSchema.optional(),
    marginLocked: LegacyFiniteNumberSchema.nonnegative().optional(),
    unrealisedPnl: LegacyFiniteNumberSchema.optional(),
    unrealizedPnl: LegacyFiniteNumberSchema.optional(),
    realisedPnl: LegacyFiniteNumberSchema.optional(),
    realizedPnl: LegacyFiniteNumberSchema.optional(),
    updatedAt: IsoDateSchema.optional(),
  })
  .refine(
    (position) =>
      position.quantity !== undefined || position.qty !== undefined,
    {
      message: "Legacy position quantity is required",
    }
  )
  .refine(
    (position) =>
      position.averagePrice !== undefined || position.avgPrice !== undefined,
    {
      message: "Legacy position average price is required",
    }
  );
export type LegacyPaperPosition = z.infer<
  typeof LegacyPaperPositionSchema
>;

export const LegacyPaperOrderSchema = z
  .object({
    id: z.string().min(1),
    symbol: z.string().trim().min(1),
    side: PaperOrderSideSchema,
    quantity: LegacyFiniteNumberSchema.optional(),
    qty: LegacyFiniteNumberSchema.optional(),
    type: PaperOrderTypeSchema,
    status: z.string().optional(),
    limitPrice: OptionalPositivePriceSchema,
    stopPrice: OptionalPositivePriceSchema,
    triggeredAt: IsoDateSchema.optional(),
    filledQuantity: LegacyFiniteNumberSchema.nonnegative().optional(),
    filledQty: LegacyFiniteNumberSchema.nonnegative().optional(),
    averageFillPrice: OptionalPositivePriceSchema,
    averagePrice: OptionalPositivePriceSchema,
    stopLossPrice: OptionalPositivePriceSchema,
    takeProfitPrice: OptionalPositivePriceSchema,
    trailingDistance: OptionalPositivePriceSchema,
    trailingHighWatermark: OptionalPositivePriceSchema,
    trailingHwm: OptionalPositivePriceSchema,
    trailingLowWatermark: OptionalPositivePriceSchema,
    trailingLwm: OptionalPositivePriceSchema,
    trailingIsPercent: z.boolean().optional(),
    isTrailingPercent: z.boolean().optional(),
    createdAt: IsoDateSchema.optional(),
    placedAt: IsoDateSchema.optional(),
    updatedAt: IsoDateSchema.optional(),
    rejectionReason: z.string().optional(),
    rejectReason: z.string().optional(),
    parentOrderId: z.string().min(1).optional(),
    quoteSource: MarketDataSourceSchema.optional(),
    quoteQuality: MarketDataQualitySchema.optional(),
    quoteTimestamp: IsoDateSchema.optional(),
    referencePrice: OptionalPositivePriceSchema,
  })
  .refine((order) => order.quantity !== undefined || order.qty !== undefined, {
    message: "Legacy order quantity is required",
  });
export type LegacyPaperOrder = z.infer<typeof LegacyPaperOrderSchema>;

export const LegacyPaperAccountSchema = z.object({
  version: z.number().optional(),
  initialCash: LegacyFiniteNumberSchema.positive().optional(),
  cash: LegacyFiniteNumberSchema,
  allocatedMargin: LegacyFiniteNumberSchema.nonnegative().optional(),
  maintenanceMargin: LegacyFiniteNumberSchema.nonnegative().optional(),
  realisedPnl: LegacyFiniteNumberSchema.optional(),
  realizedPnl: LegacyFiniteNumberSchema.optional(),
  status: z.string().optional(),
  isLocked: z.boolean().optional(),
  lockReason: z.string().optional(),
  lockedAt: IsoDateSchema.optional(),
  liquidationCompletedAt: IsoDateSchema.optional(),
  positions: z.array(LegacyPaperPositionSchema),
  orders: z.array(LegacyPaperOrderSchema).optional(),
  fills: z.array(z.unknown()).optional(),
});
export type LegacyPaperAccount = z.infer<typeof LegacyPaperAccountSchema>;
