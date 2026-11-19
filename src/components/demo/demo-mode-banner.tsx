import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { DEMO_BANNER_TEXT, setDemoModeActive } from "./demo-mode";

/** Loads demo mode and records it before the result reaches any component. */
async function loadDemoMode(): Promise<boolean> {
  const { demoMode } = await trpc.capabilities.get.query();
  setDemoModeActive(demoMode === true);
  return demoMode === true;
}

/** Permanent notice for demo deployments: no close control, stays above every page. */
export function DemoModeBanner() {
  return (
    <div role="status" className="sticky top-0 z-50 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-center text-xs font-medium text-amber-200">
      {DEMO_BANNER_TEXT}
      <span className="ml-2 font-normal text-amber-200/80">Symbols prefixed DEMO-, their prices, fills and backtests are generated.</span>
    </div>
  );
}

/**
 * Shows the banner when the server reports demo mode. The app below is keyed by the mode, so once
 * demo mode is known every quote label is rendered again as synthetic (quoteSourceLabel reads it).
 * Outside demo mode the key never changes and nothing re-mounts.
 */
export function DemoModeGate({ children }: { children: ReactNode }) {
  const { data: demoMode = false } = useQuery({
    queryKey: ["capabilities", "demoMode"],
    queryFn: loadDemoMode,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return (
    <>
      {demoMode && <DemoModeBanner />}
      <Fragment key={demoMode ? "demo" : "standard"}>{children}</Fragment>
    </>
  );
}
