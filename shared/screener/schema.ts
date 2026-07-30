/**
 * Screener DSL schema — maps natural language fields to screener criteria fields.
 */

import { z } from "zod";
import type { NlField } from "./ast";

export interface FieldMapping {
  nlField: NlField;
  screenerField: string;
  unit: "%" | "x" | "cr" | "ratio" | "rs" | "";
  parser: (raw: string) => number | string;
}

const parseNumber = (raw: string): number => {
  const cleaned = raw.replace(/[,%]/g, "").trim();
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) throw new Error(`Invalid number: ${raw}`);
  return n;
};

const parsePercent = (raw: string): number => {
  return parseNumber(raw) / 100;
};

const parseAbsolute = (raw: string): number => {
  return parseNumber(raw);
};

export const FIELD_MAPPINGS: FieldMapping[] = [
  { nlField: "pe_ratio", screenerField: "pe", unit: "x", parser: parseAbsolute },
  { nlField: "pb_ratio", screenerField: "pb", unit: "x", parser: parseAbsolute },
  { nlField: "roe", screenerField: "roe", unit: "%", parser: parsePercent },
  { nlField: "roce", screenerField: "roce", unit: "%", parser: parsePercent },
  { nlField: "revenue_growth", screenerField: "revenue_growth", unit: "%", parser: parsePercent },
  { nlField: "eps_growth", screenerField: "eps_growth", unit: "%", parser: parsePercent },
  { nlField: "net_margin", screenerField: "net_margin", unit: "%", parser: parsePercent },
  { nlField: "gross_margin", screenerField: "gross_margin", unit: "%", parser: parsePercent },
  { nlField: "debt_to_equity", screenerField: "debt_to_equity", unit: "ratio", parser: parseAbsolute },
  { nlField: "current_ratio", screenerField: "current_ratio", unit: "ratio", parser: parseAbsolute },
  { nlField: "dividend_yield", screenerField: "dividend_yield", unit: "%", parser: parsePercent },
  { nlField: "market_cap", screenerField: "market_cap", unit: "cr", parser: parseAbsolute },
  { nlField: "price", screenerField: "price", unit: "", parser: parseAbsolute },
  { nlField: "volume", screenerField: "volume", unit: "", parser: parseAbsolute },
  { nlField: "rsi", screenerField: "rsi", unit: "", parser: parseAbsolute },
  { nlField: "macd", screenerField: "macd", unit: "", parser: parseAbsolute },
  { nlField: "sma_cross", screenerField: "sma_cross", unit: "", parser: parseAbsolute },
  { nlField: "price_above_sma", screenerField: "price_above_sma", unit: "", parser: parseAbsolute },
  { nlField: "volume_spike", screenerField: "volume_spike", unit: "", parser: parseAbsolute },
  { nlField: "sector", screenerField: "sector", unit: "", parser: (s) => s },
  { nlField: "industry", screenerField: "industry", unit: "", parser: (s) => s },
];

export const KNOWN_FIELDS = FIELD_MAPPINGS.map((m) => m.nlField);
export const KNOWN_OPERATORS = ["above", "below", "between", "crosses_above", "crosses_below", "within"];

export const BOOLEAN_CONNECTORS = ["and", "or"];

export const CAP_KEYWORDS = ["large cap", "mid cap", "small cap", "largecap", "midcap", "smallcap"];