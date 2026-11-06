import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/futures")({
  head: () => ({ meta: [{ title: "Futures — MAET" }] }),
  component: Futures,
});

function Futures() {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
        <h1 className="text-xl font-semibold">Futures</h1>
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          No futures feed is connected. MAET ingests NSE cash-market quotes and Angel One NFO option chains only, so there are
          no futures contracts, open interest, basis or margins to show here.
        </p>
        <p className="mt-2 text-sm">
          <Link to="/options/$underlying" params={{ underlying: "NIFTY" }} className="text-primary hover:underline">
            NIFTY option chain
          </Link>
        </p>
      </div>
    </div>
  );
}
