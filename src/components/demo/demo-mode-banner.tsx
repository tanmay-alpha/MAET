import { DEMO_BANNER_TEXT, isDemoBuild } from "./demo-mode";

/** Permanent notice in demo builds: no close control, stays above every page. Renders nothing otherwise. */
export function DemoModeBanner() {
  if (!isDemoBuild()) return null;
  return (
    <div role="status" className="sticky top-0 z-50 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-center text-xs font-medium text-amber-200">
      {DEMO_BANNER_TEXT}
      <span className="ml-2 font-normal text-amber-200/80">Symbols prefixed DEMO-, their prices, fills and backtests are generated.</span>
    </div>
  );
}
