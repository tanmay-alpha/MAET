/**
 * Demo mode as reported by the server (`capabilities.get` → `demoMode`, set by MAET_DEMO_MODE=1).
 * Kept outside React so plain label helpers (quoteSourceLabel) can read it; DemoModeGate sets it
 * before re-rendering the app with the answer.
 */
let demoModeActive = false;

export const DEMO_BANNER_TEXT = "Demo — synthetic data, not market data";
export const SYNTHETIC_QUOTE_LABEL = "Synthetic demo data · not market data";

export function isDemoModeActive(): boolean {
  return demoModeActive;
}

export function setDemoModeActive(active: boolean): void {
  demoModeActive = active;
}
