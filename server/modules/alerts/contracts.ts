/**
 * Server alert engine — replaces browser-local alert authority.
 *
 * Supports:
 *  PRICE_ABOVE, PRICE_BELOW
 *  PERCENT_CHANGE_ABOVE, PERCENT_CHANGE_BELOW
 *  VOLUME_ABOVE, RELATIVE_VOLUME_ABOVE
 *  RSI_ABOVE, RSI_BELOW
 *  MACD_CROSS_ABOVE, MACD_CROSS_BELOW
 *  PRICE_CROSS_SMA
 *  SCREENER_MATCH
 */

import { z } from "zod";

export const AlertTypeSchema = z.enum([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PERCENT_CHANGE_ABOVE",
  "PERCENT_CHANGE_BELOW",
  "VOLUME_ABOVE",
  "RELATIVE_VOLUME_ABOVE",
  "RSI_ABOVE",
  "RSI_BELOW",
  "MACD_CROSS_ABOVE",
  "MACD_CROSS_BELOW",
  "PRICE_CROSS_SMA",
  "SCREENER_MATCH",
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

export const AlertModeSchema = z.enum(["one_time", "repeating"]);
export type AlertMode = z.infer<typeof AlertModeSchema>;

export const AlertConfigSchema = z.object({
  type: AlertTypeSchema,
  threshold: z.number().optional(),
  period: z.number().int().positive().optional(),
  screenerId: z.string().optional(),
  smaPeriod: z.number().int().positive().optional(),
  cooldownMinutes: z.number().int().positive().default(60),
  mode: AlertModeSchema.default("one_time"),
});
export type AlertConfig = z.infer<typeof AlertConfigSchema>;

export const AlertDefinitionInputSchema = z.object({
  symbol: z.string().min(1),
  config: AlertConfigSchema,
  enabled: z.boolean().default(true),
  label: z.string().min(1).max(100).optional(),
});
export type AlertDefinitionInput = z.infer<typeof AlertDefinitionInputSchema>;

export interface AlertEvaluation {
  triggered: boolean;
  reason: string;
  currentValue: number;
  threshold: number;
  indicatorValue?: number;
  quoteSource: string;
  quoteTimestamp: number;
}