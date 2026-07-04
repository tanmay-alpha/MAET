import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowLeft, Database, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_app/options/$underlying")({
  head: () => ({ meta: [{ title: "Options Chain — MAET" }] }),
  component: OptionsChain,
});

function OptionsChain() {
  const { underlying } = Route.useParams();
  const symbol = underlying.trim().toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Link
          to="/screener"
          className="rounded border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to screener"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Options Chain</h1>
            <span className="rounded bg-accent px-2 py-0.5 font-mono text-xs text-muted-foreground">{symbol}</span>
          </div>
          <p className="text-sm text-muted-foreground">NSE derivatives data</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <section className="w-full max-w-2xl rounded-lg border border-border bg-panel p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-base font-semibold">Verified NSE derivatives provider is not connected yet</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                MAET does not currently have a verified NSE derivatives provider for {symbol}. No simulated option-chain
                values are shown; prices, open interest, volume, implied volatility, PCR, and Greeks remain unavailable.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-border bg-background p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Database className="h-4 w-4 text-primary" /> Required source
              </div>
              <p className="text-xs leading-5 text-muted-foreground">Authenticated option-chain quotes with exchange timestamps and contract identifiers.</p>
            </div>
            <div className="rounded border border-border bg-background p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 text-primary" /> Activation rule
              </div>
              <p className="text-xs leading-5 text-muted-foreground">This table will activate only after the provider payload is validated and stored server-side.</p>
            </div>
          </div>

          <div className="mt-5 rounded border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            No market values are fabricated on this screen.
          </div>
        </section>
      </div>
    </div>
  );
}
