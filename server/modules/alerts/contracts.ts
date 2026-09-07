/**
 * Alert subsystem contracts.
 * Strict schemas for creation, evaluation, and view representation.
 */

import { z } from "zod";

export const CreatableAlertTypeSchema = z.enum([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PERCENT_CHANGE_ABOVE",
  "PERCENT_CHANGE_BELOW",
  "VOLUME_ABOVE",
]);
export type CreatableAlertType = z.infer<typeof CreatableAlertTypeSchema>;

export const HistoricalAlertTypeSchema = z.enum([
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
export type HistoricalAlertType = z.infer<typeof HistoricalAlertTypeSchema>;

export const AlertTypeSchema = HistoricalAlertTypeSchema;
export type AlertType = z.infer<typeof AlertTypeSchema>;

export function isSupportedAlertType(type: string): type is CreatableAlertType {
  return CreatableAlertTypeSchema.safeParse(type).success;
}

export const AlertModeSchema = z.enum(["one_time", "repeating"]);
export type AlertMode = z.infer<typeof AlertModeSchema>;

const PriceAboveConfigSchema = z.object({
  type: z.literal("PRICE_ABOVE"),
  threshold: z.number().finite().positive("Threshold must be a positive number"),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  mode: AlertModeSchema.default("one_time"),
});

const PriceBelowConfigSchema = z.object({
  type: z.literal("PRICE_BELOW"),
  threshold: z.number().finite().positive("Threshold must be a positive number"),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  mode: AlertModeSchema.default("one_time"),
});

const PercentChangeAboveConfigSchema = z.object({
  type: z.literal("PERCENT_CHANGE_ABOVE"),
  threshold: z.number().finite("Threshold must be a finite number"),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  mode: AlertModeSchema.default("one_time"),
});

const PercentChangeBelowConfigSchema = z.object({
  type: z.literal("PERCENT_CHANGE_BELOW"),
  threshold: z.number().finite("Threshold must be a finite number"),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  mode: AlertModeSchema.default("one_time"),
});

const VolumeAboveConfigSchema = z.object({
  type: z.literal("VOLUME_ABOVE"),
  threshold: z.number().int().positive("Threshold must be a positive integer number of shares"),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  mode: AlertModeSchema.default("one_time"),
});

export const CreatableAlertConfigSchema = z.discriminatedUnion("type", [
  PriceAboveConfigSchema,
  PriceBelowConfigSchema,
  PercentChangeAboveConfigSchema,
  PercentChangeBelowConfigSchema,
  VolumeAboveConfigSchema,
]);
export type CreatableAlertConfig = z.infer<typeof CreatableAlertConfigSchema>;

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

export const CreateAlertInputSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(20, "Symbol cannot exceed 20 characters")
    .transform((s) => s.toUpperCase()),
  label: z
    .string()
    .trim()
    .max(100, "Label cannot exceed 100 characters")
    .optional()
    .transform((l) => (l && l.length > 0 ? l : undefined)),
  config: CreatableAlertConfigSchema,
  enabled: z.boolean().default(true),
});
export type CreateAlertInput = z.infer<typeof CreateAlertInputSchema>;
export const AlertDefinitionInputSchema = CreateAlertInputSchema;
export type AlertDefinitionInput = CreateAlertInput;

export interface AlertView {
  id: string;
  symbol: string;
  exchange: string;
  type: string;
  label: string | null;
  threshold: number | null;
  enabled: boolean;
  mode: "one_time" | "repeating";
  cooldownMinutes: number;
  triggered: boolean;
  triggeredAt: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
  supported: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertTriggerView {
  id: string;
  alertId: string;
  symbol: string;
  exchange: string;
  conditionType: string;
  observedValue: number | null;
  targetValue: number | null;
  message: string | null;
  provider: string;
  providerTimestamp: string | null;
  triggeredAt: string;
}

export interface AlertNotificationView {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  symbol: string | null;
  alertId: string | null;
  alertEventId: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface AlertEvaluation {
  triggered: boolean;
  reason: string;
  currentValue: number;
  threshold: number;
  indicatorValue?: number;
  quoteSource: string;
  quoteTimestamp: number;
}