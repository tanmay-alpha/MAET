export function FlowsWidget() {
  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Institutional flows</div>
      <div className="mt-5 rounded-md border border-dashed border-border px-4 py-8 text-center">
        <div className="text-sm font-medium">Flow feed unavailable</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Yahoo does not provide verified FII/DII cash-flow data. MAET will not invent these values.
        </div>
      </div>
    </div>
  );
}
