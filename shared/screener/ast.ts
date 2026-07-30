/**
 * Screener AST types shared between frontend and backend.
 *
 * The AST is the intermediate representation between the natural language
 * parser and the compiled screener criteria. It is always deterministically
 * produced; no LLM is involved.
 */

import { z } from "zod";

// --- AST nodes ---

export type NlField =
  | "pe_ratio"
  | "pb_ratio"
  | "roe"
  | "roce"
  | "revenue_growth"
  | "eps_growth"
  | "net_margin"
  | "gross_margin"
  | "debt_to_equity"
  | "current_ratio"
  | "dividend_yield"
  | "market_cap"
  | "price"
  | "volume"
  | "rsi"
  | "macd"
  | "sma_cross"
  | "price_above_sma"
  | "volume_spike"
  | "sector"
  | "industry";

export type NlOperator =
  | "above"
  | "below"
  | "between"
  | "crosses_above"
  | "crosses_below"
  | "within";

export type NlBooleanOp = "and" | "or";

export interface NlLiteralNode {
  kind: "literal";
  field: NlField;
  op: NlOperator;
  value: number | string;
}

export interface NlCompositeNode {
  kind: "composite";
  op: NlBooleanOp;
  children: NlNode[];
}

export type NlNode = NlLiteralNode | NlCompositeNode;

// --- Compiled filter ---

export interface CompiledFilter {
  field: string;
  op: string;
  value: unknown;
}

// --- Schema ---

export const NlFieldSchema = z.enum([
  "pe_ratio", "pb_ratio", "roe", "roce", "revenue_growth", "eps_growth",
  "net_margin", "gross_margin", "debt_to_equity", "current_ratio",
  "dividend_yield", "market_cap", "price", "volume",
  "rsi", "macd", "sma_cross", "price_above_sma", "volume_spike",
  "sector", "industry",
]);

export const NlOperatorSchema = z.enum(["above", "below", "between", "crosses_above", "crosses_below", "within"]);

export const NlBooleanOpSchema = z.enum(["and", "or"]);

export const NlLiteralNodeSchema: z.ZodType<NlLiteralNode> = z.lazy(() =>
  z.object({
    kind: z.literal("literal"),
    field: NlFieldSchema,
    op: NlOperatorSchema,
    value: z.union([z.number(), z.string()]),
  })
);

export const NlCompositeNodeSchema: z.ZodType<NlCompositeNode> = z.lazy(() =>
  z.object({
    kind: z.literal("composite"),
    op: NlBooleanOpSchema,
    children: z.array(z.lazy(() => z.union([NlLiteralNodeSchema, NlCompositeNodeSchema]))).min(1),
  })
);

export const NlNodeSchema: z.ZodType<NlNode> = z.lazy(() =>
  z.union([NlLiteralNodeSchema, NlCompositeNodeSchema])
);

export const NlParseResultSchema = z.object({
  ast: NlNodeSchema,
  original: z.string(),
  parseErrors: z.array(z.string()).default([]),
});

export type NlParseResult = z.infer<typeof NlParseResultSchema>;