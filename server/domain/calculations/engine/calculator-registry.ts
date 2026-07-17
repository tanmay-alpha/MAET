/**
 * Calculator Registry — Metadata registry for all calculators
 * Maps calculator name → metadata + factory function
 */

export type CalculatorCategory =
  | "trend" | "momentum" | "volatility" | "volume"
  | "oscillators" | "pattern" | "cycle" | "correlation" | "custom"
  | "profitability" | "valuation" | "growth" | "health" | "efficiency" | "quality" | "composite"
  | "scanner-breakout" | "scanner-value" | "scanner-momentum" | "scanner-quality" | "scanner-technical"
  | "portfolio-risk" | "portfolio-attribution" | "portfolio-performance";

export type CalculatorFrequency = "realtime" | "daily" | "weekly" | "quarterly" | "on-demand";

export interface CalculatorMeta {
  name: string;
  displayName: string;
  category: CalculatorCategory;
  frequency: CalculatorFrequency;
  description: string;
  requiredFields: string[];  // input data fields required
  outputFields: string[];    // output field names
  defaultParams?: Record<string, unknown>;
}

export interface CalculatorInput {
  symbol: string;
  closes?: number[];
  opens?: number[];
  highs?: number[];
  lows?: number[];
  volumes?: number[];
  dates?: string[];
  financials?: Record<string, number | null>;
  marketData?: Record<string, number | null>;
  period?: string;
  params?: Record<string, unknown>;
}

export interface CalculatorOutput {
  symbol: string;
  indicatorName: string;
  date: string;
  value: number | null;
  signal?: number | null;
  hist?: number | null;
  components?: Record<string, number | null>;
  metadata?: Record<string, unknown>;
}

export type CalculatorFn = (input: CalculatorInput) => CalculatorOutput[];

export interface CalculatorEntry {
  meta: CalculatorMeta;
  calculate: CalculatorFn;
}

const registry = new Map<string, CalculatorEntry>();

export function registerCalculator(entry: CalculatorEntry): void {
  registry.set(entry.meta.name, entry);
}

export function getCalculator(name: string): CalculatorEntry | undefined {
  return registry.get(name);
}

export function getAllCalculators(): CalculatorEntry[] {
  return Array.from(registry.values());
}

export function getCalculatorsByCategory(category: CalculatorCategory): CalculatorEntry[] {
  return Array.from(registry.values()).filter((e) => e.meta.category === category);
}

export function getCalculatorsByFrequency(frequency: CalculatorFrequency): CalculatorEntry[] {
  return Array.from(registry.values()).filter((e) => e.meta.frequency === frequency);
}

export function getRegistryStats(): Record<string, number> {
  const stats: Record<string, number> = { total: registry.size };
  for (const entry of registry.values()) {
    stats[entry.meta.category] = (stats[entry.meta.category] ?? 0) + 1;
  }
  return stats;
}

// ============================================================================
// Register all calculators by importing calculator modules
// ============================================================================

// These imports register calculators into the global registry
import "../calculators/indicators/register-indicators";
import "../calculators/fundamentals/register-fundamentals";
import "../calculators/scanners/register-scanners";
import "../calculators/portfolio/register-portfolio";
