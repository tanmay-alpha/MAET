/**
 * The fictitious demo universe. Every symbol carries the DEMO- prefix (no NSE symbol contains a
 * hyphen-prefixed DEMO) and every name says it is synthetic, so seeded rows can never be mistaken
 * for, or collide with, real listings.
 */

import type { DemoSeriesSpec } from "./generator";

export const DEMO_SYMBOL_PREFIX = "DEMO-";
/** Stored in companies.data_source and quote_snapshots/candles source columns. */
export const DEMO_DATA_SOURCE = "synthetic-demo";
/** Fixed seed: the demo dataset is identical on every machine and every run. */
export const DEMO_SEED = 20_261_119;
/** Demo history: the bundled NSE holiday year, up to a fixed end so reruns never drift. */
export const DEMO_FROM = "2026-01-01";
export const DEMO_TO = "2026-11-18";

export interface DemoCompany extends DemoSeriesSpec {
  name: string;
  sector: string;
  industry: string;
  sharesOutstanding: number;
}

export const DEMO_COMPANIES: readonly DemoCompany[] = [
  { symbol: "DEMO-ARKA", name: "Arka Power Grid (synthetic demo)", sector: "Utilities", industry: "Power Transmission", startPrice: 312.4, volatilityScale: 0.9, baseVolume: 2_400_000, sharesOutstanding: 930_000_000 },
  { symbol: "DEMO-BHAV", name: "Bhavya Consumer Foods (synthetic demo)", sector: "Consumer Staples", industry: "Packaged Foods", startPrice: 1_845, volatilityScale: 0.7, baseVolume: 410_000, sharesOutstanding: 240_000_000 },
  { symbol: "DEMO-CHIT", name: "Chitra Software Systems (synthetic demo)", sector: "Information Technology", industry: "IT Services", startPrice: 1_120.5, volatilityScale: 1.1, baseVolume: 1_150_000, sharesOutstanding: 410_000_000 },
  { symbol: "DEMO-DHRU", name: "Dhruva Steel Works (synthetic demo)", sector: "Materials", industry: "Steel", startPrice: 148.9, volatilityScale: 1.45, baseVolume: 6_800_000, sharesOutstanding: 1_220_000_000 },
  { symbol: "DEMO-EKAM", name: "Ekam Private Bank (synthetic demo)", sector: "Financials", industry: "Private Banks", startPrice: 968, volatilityScale: 1, baseVolume: 3_100_000, sharesOutstanding: 1_540_000_000 },
  { symbol: "DEMO-GATI", name: "Gati Auto Components (synthetic demo)", sector: "Consumer Discretionary", industry: "Auto Parts", startPrice: 2_430, volatilityScale: 1.25, baseVolume: 260_000, sharesOutstanding: 96_000_000 },
  { symbol: "DEMO-JALA", name: "Jala Specialty Chemicals (synthetic demo)", sector: "Materials", industry: "Specialty Chemicals", startPrice: 676.35, volatilityScale: 1.3, baseVolume: 720_000, sharesOutstanding: 180_000_000 },
  { symbol: "DEMO-NIRA", name: "Nira Healthcare Labs (synthetic demo)", sector: "Health Care", industry: "Pharmaceuticals", startPrice: 504.2, volatilityScale: 0.85, baseVolume: 1_350_000, sharesOutstanding: 520_000_000 },
];
