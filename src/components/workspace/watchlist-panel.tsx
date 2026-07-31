import React, { useState } from "react";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";

export function WatchlistPanel() {
  const { watchlists, createWatchlist, removeWatchlistItem } = useResearchWorkspace();
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWatchlistName.trim()) return;
    setIsCreating(true);
    try {
      await createWatchlist(newWatchlistName.trim());
      setNewWatchlistName("");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold tracking-tight">User Watchlists</h2>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="New Watchlist Name..."
          value={newWatchlistName}
          onChange={(e) => setNewWatchlistName(e.target.value)}
          className="flex-1 rounded-md border px-3 py-2 text-sm bg-background"
        />
        <button
          type="submit"
          disabled={isCreating || !newWatchlistName.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      <div className="space-y-4">
        {watchlists.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No watchlists found. Create your first watchlist above.</p>
        ) : (
          watchlists.map((wl: any) => (
            <div key={wl.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between font-medium">
                <span>{wl.name}</span>
                <span className="text-xs text-muted-foreground">{wl.items?.length ?? 0} symbols</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
