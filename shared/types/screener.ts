import { z } from "zod";
import { ExchangeSchema } from "./market";

export const CriterionFieldSchema = z.enum([
  "pe",
  "pb",
  "roe",
  "market_cap",
  "dividend_yield",
  "sector",
  "rsi",
  "sma_cross",
  "price_above_sma",
  "volume_spike",
]);
export type CriterionField = z.infer<typeof CriterionFieldSchema>;

export const CriterionOpSchema = z.enum(["eq", "gt", "lt", "gte", "lte", "between"]);
export type CriterionOp = z.infer<typeof CriterionOpSchema>;

export const CriterionLeafSchema = z.object({
  field: CriterionFieldSchema,
  op: CriterionOpSchema,
  value: z.union([z.number(), z.string(), z.tuple([z.number(), z.number()])]),
  period: z.number().int().positive().optional(),
});
export type CriterionLeaf = z.infer<typeof CriterionLeafSchema>;

export const CriterionSchema: z.ZodType<Criterion> = z.lazy(() =>
  z.union([
    CriterionLeafSchema,
    z.object({
      op: z.enum(["AND", "OR"]),
      children: z.array(CriterionSchema).min(1),
    }),
  ])
);
export type Criterion = CriterionLeaf | { op: "AND" | "OR"; children: Criterion[] };

export const ScreenerSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  exchange: ExchangeSchema,
  criteria: CriterionSchema,
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
});
export type Screener = z.infer<typeof ScreenerSchema>;
