import { useResearchWorkspace } from "@/hooks/use-research-workspace";

export function RecentRuns() {
  const { recentRuns } = useResearchWorkspace();

  return (
    <section className="border border-border bg-panel">
      <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Recent screener runs</h2>
      {recentRuns.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">No runs recorded.</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {recentRuns.map((run) => (
              <tr key={run.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{run.id.slice(0, 8)}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{new Date(run.runStartedAt).toLocaleString("en-IN")}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{run.matchCount ?? 0} matches</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
