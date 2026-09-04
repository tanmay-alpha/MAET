import { createFileRoute } from "@tanstack/react-router";
import { ListFilter } from "lucide-react";
import { WatchlistPanel } from "@/components/workspace/watchlist-panel";

export const Route = createFileRoute("/_app/watchlists")({
  head: () => ({ meta: [{ title: "Watchlists — MAET" }] }),
  component: WatchlistsPage,
});

function WatchlistsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
          <ListFilter className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watchlists</h1>
          <p className="text-sm text-muted-foreground">Account-backed workspace</p>
        </div>
      </header>

      <WatchlistPanel />
    </div>
  );
}
