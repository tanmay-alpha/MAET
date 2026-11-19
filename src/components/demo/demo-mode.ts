/**
 * Demo mode is a build-time flag: a demo deployment builds the frontend with VITE_MAET_DEMO_MODE=1
 * (and runs the server with MAET_DEMO_MODE=1, which `capabilities.get` reports as `demoMode` for
 * API consumers). Vite inlines the value, so ordinary builds make no request and render nothing
 * extra. Read per call so tests can set the variable.
 */
export function isDemoBuild(): boolean {
  return import.meta.env.VITE_MAET_DEMO_MODE === "1";
}

export const DEMO_BANNER_TEXT = "Demo — synthetic data, not market data";
export const SYNTHETIC_QUOTE_LABEL = "Synthetic demo data · not market data";
