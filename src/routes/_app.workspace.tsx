import { createFileRoute } from "@tanstack/react-router";
import { WatchlistPanel } from "@/components/workspace/watchlist-panel";
import { SavedScreeners } from "@/components/workspace/saved-screeners";
import { RecentRuns } from "@/components/workspace/recent-runs";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";

export const Route = createFileRoute("/_app/workspace")({
  head: () => ({ meta: [{ title: "Cloud Workspace — MAET" }] }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { overview, isLoading } = useResearchWorkspace();

  return (
    <div className="container mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Cloud Workspace</h1>
        <p className="text-muted-foreground">Manage your custom watchlists, saved screeners, and execution history.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Total Watchlists</p>
          <p className="text-2xl font-bold">{isLoading ? "..." : overview?.watchlistCount ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Saved Screeners</p>
          <p className="text-2xl font-bold">{isLoading ? "..." : overview?.screenerCount ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Unread Notifications</p>
          <p className="text-2xl font-bold">{isLoading ? "..." : overview?.unreadNotifications ?? 0}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <WatchlistPanel />
        <div className="space-y-6">
          <SavedScreeners />
          <RecentRuns />
        </div>
      </div>
    </div>
  );
}
