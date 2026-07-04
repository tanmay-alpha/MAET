import { createFileRoute, Link } from "@tanstack/react-router";
import { CandlestickChart, DatabaseZap, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_app/futures")({
  head: () => ({ meta: [{ title: "Futures — MAET" }] }),
  component: Futures,
});

function Futures() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border bg-panel px-5 py-4">
        <div className="flex items-center gap-2"><CandlestickChart className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">Futures Desk</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">NSE F&amp;O and MCX contract intelligence</p>
      </header>

      <div className="flex flex-1 items-center justify-center p-6">
        <section className="w-full max-w-3xl rounded-lg border border-border bg-panel p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400"><ShieldAlert className="h-6 w-6" /></div>
            <div>
              <h2 className="text-base font-semibold">Verified futures provider is not connected yet</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">MAET’s current Angel One integration supplies verified cash-market quotes and instrument tokens. It does not yet ingest validated futures contracts, expiries, lot sizes, open interest, basis, SPAN margin, or MCX data. No cash-derived or simulated futures values are shown.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded border border-border bg-background p-4"><div className="flex items-center gap-2 text-sm font-medium"><DatabaseZap className="h-4 w-4 text-primary" />Required ingestion</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Verified contract master plus timestamped futures LTP, volume, open interest, expiry and exchange identifiers.</p></div>
            <div className="rounded border border-border bg-background p-4"><div className="text-sm font-medium">Activation criteria</div><p className="mt-2 text-xs leading-5 text-muted-foreground">The desk activates only after provider payloads are validated, normalized and stored server-side.</p></div>
          </div>

          <div className="mt-5 flex items-center justify-between rounded border border-dashed border-border px-4 py-3 text-xs text-muted-foreground"><span>No market values are fabricated on this screen.</span><Link to="/options/$underlying" params={{ underlying: "NIFTY" }} className="text-primary hover:underline">Options availability</Link></div>
        </section>
      </div>
    </div>
  );
}
