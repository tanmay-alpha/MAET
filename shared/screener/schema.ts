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

// Only fields the screener engine (server/domain/screener/engine.ts) can evaluate from its
// tick/fundamentals/candle context. Other NlFields are still tokenized so the compiler can
// report them as unsupported instead of emitting criteria that never match. Sector/industry
// need an equality operator the DSL grammar does not have, so they would never match either.
export const FIELD_MAPPINGS: FieldMapping[] = [
  { nlField: "pe_ratio", screenerField: "pe", unit: "x", parser: parseAbsolute },
  { nlField: "pb_ratio", screenerField: "pb", unit: "x", parser: parseAbsolute },
  { nlField: "roe", screenerField: "roe", unit: "%", parser: parsePercent },
  { nlField: "dividend_yield", screenerField: "dividend_yield", unit: "%", parser: parsePercent },
  { nlField: "market_cap", screenerField: "market_cap", unit: "cr", parser: parseAbsolute },
  { nlField: "price", screenerField: "price", unit: "", parser: parseAbsolute },
  { nlField: "volume", screenerField: "volume", unit: "", parser: parseAbsolute },
  { nlField: "rsi", screenerField: "rsi", unit: "", parser: parseAbsolute },
  { nlField: "macd", screenerField: "macd", unit: "", parser: parseAbsolute },
];

export const KNOWN_OPERATORS = ["above", "below", "between", "crosses_above", "crosses_below", "within"];