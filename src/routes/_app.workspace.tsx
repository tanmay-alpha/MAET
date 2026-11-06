import { createFileRoute } from "@tanstack/react-router";
import { WatchlistPanel } from "@/components/workspace/watchlist-panel";
import { SavedScreeners } from "@/components/workspace/saved-screeners";
import { RecentRuns } from "@/components/workspace/recent-runs";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";
import { useSignedIn } from "@/hooks/use-signed-in";

export const Route = createFileRoute("/_app/workspace")({
  head: () => ({ meta: [{ title: "Workspace — MAET" }] }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const signedIn = useSignedIn();
  const { overview } = useResearchWorkspace();

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">Workspace</h1>
          {overview && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {overview.watchlistCount} watchlists · {overview.screenerCount} saved screeners · {overview.unreadNotifications} unread
            </span>
          )}
        </header>

        {!signedIn ? (
          <SignedOutNotice feature="Watchlists, saved screeners and screener runs" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <WatchlistPanel />
            <div className="space-y-4">
              <SavedScreeners />
              <RecentRuns />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
