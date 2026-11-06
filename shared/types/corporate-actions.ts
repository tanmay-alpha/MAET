import { z } from "zod";

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/**
 * A cash dividend as the provider reports it. Yahoo restates older dividends
 * for later splits, bonuses and rights issues, so `adjusted` marks amounts that
 * are not the per-share amount paid at the time. The original amount is not
 * in the response.
 */
export const DividendEventSchema = z.object({
  kind: z.literal("dividend"),
  /** Ex-date, exchange-local (IST) calendar date. */
  exDate: IsoDateSchema,
  amount: z.number().finite().positive(),
  currency: z.string().min(1),
  adjusted: z.boolean(),
});

/**
 * A change in share count: `numerator` new shares for every `denominator` held.
 * Yahoo reports NSE bonus issues as splits (a 1:1 bonus is 2:1), so the two
 * cannot be told apart from this source.
 */
export const SplitEventSchema = z.object({
  kind: z.literal("split"),
  exDate: IsoDateSchema,
  numerator: z.number().finite().positive(),
  denominator: z.number().finite().positive(),
});

export const CorporateActionEventSchema = z.discriminatedUnion("kind", [DividendEventSchema, SplitEventSchema]);
export type DividendEvent = z.infer<typeof DividendEventSchema>;
export type SplitEvent = z.infer<typeof SplitEventSchema>;
export type CorporateActionEvent = z.infer<typeof CorporateActionEventSchema>;

/** Body of GET /api/market/corporate-actions. Events are newest first. */
export const CorporateActionsResponseSchema = z.object({
  symbol: z.string(),
  source: z.literal("yahoo"),
  /** When the provider was last read successfully. */
  asOf: z.string().datetime(),
  /** True when the refresh failed and an older cached copy is served. */
  stale: z.boolean(),
  events: z.array(CorporateActionEventSchema),
});
export type CorporateActionsResponse = z.infer<typeof CorporateActionsResponseSchema>;
