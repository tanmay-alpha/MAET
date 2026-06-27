export function DepthMeter() {
  return (
    <div className="rounded-md border border-border bg-panel/80 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Order book · NSE</div>
      <div className="mt-5 rounded border border-dashed border-border px-3 py-6 text-center">
        <div className="text-xs font-medium">Level 2 depth unavailable</div>
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Yahoo provides quotes and candles, not exchange order-book depth. No synthetic levels are shown.
        </div>
      </div>
    </div>
  );
}
