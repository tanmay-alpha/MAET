import React from "react";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";

export function SavedScreeners() {
  const { savedScreeners, deleteScreener } = useResearchWorkspace();

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight mb-4">Saved Screeners</h2>

      <div className="space-y-3">
        {savedScreeners.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No saved screeners. Save screeners from the Screener page.</p>
        ) : (
          savedScreeners.map((scr: any) => (
            <div key={scr.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <h4 className="font-medium text-sm">{scr.name}</h4>
                {scr.description && <p className="text-xs text-muted-foreground">{scr.description}</p>}
              </div>
              <button
                onClick={() => deleteScreener(scr.id)}
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
