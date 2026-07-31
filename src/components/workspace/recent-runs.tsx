import React from "react";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";

export function RecentRuns() {
  const { recentRuns } = useResearchWorkspace();

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight mb-4">Recent Screener Runs</h2>

      <div className="space-y-3">
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No recent runs recorded.</p>
        ) : (
          recentRuns.map((run: any) => (
            <div key={run.id} className="flex items-center justify-between text-sm rounded-md border p-3">
              <div>
                <p className="font-medium">Run ID: {run.id.slice(0, 8)}</p>
                <p className="text-xs text-muted-foreground">{new Date(run.runStartedAt).toLocaleString()}</p>
              </div>
              <span className="rounded bg-secondary px-2 py-1 text-xs">
                {run.matchCount ?? 0} matches
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
