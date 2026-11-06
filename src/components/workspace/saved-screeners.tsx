import { Link } from "@tanstack/react-router";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";

export function SavedScreeners() {
  const { savedScreeners, deleteScreener } = useResearchWorkspace();

  return (
    <section className="border border-border bg-panel">
      <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Saved screeners</h2>
      {savedScreeners.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">
          None yet. Save a view from the <Link to="/screener" className="text-primary hover:underline">screener</Link>.
        </p>
      ) : (
        <ul>
          {savedScreeners.map((screener) => (
            <li key={screener.id} className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm">{screener.name}</p>
                {screener.description && <p className="truncate text-xs text-muted-foreground">{screener.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => void deleteScreener(screener.id)}
                className="shrink-0 text-xs text-muted-foreground hover:text-bear"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
