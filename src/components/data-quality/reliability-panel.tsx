import type { ReactNode } from "react";
import type { ReliabilityReport, Unavailable } from "../../../server/modules/data-quality/contracts";
import { formatIst } from "./badges";

function Block<T extends { available: true }>({
  title,
  section,
  children,
}: {
  title: string;
  section: T | Unavailable;
  children: (value: T) => ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      {section.available ? (
        children(section as T)
      ) : (
        <p className="text-xs text-muted-foreground">Unavailable: {section.reason}</p>
      )}
    </div>
  );
}

const when = (iso: string | null) => (iso ? formatIst(iso) : "never recorded");

const CHECK_LABELS: Record<string, string> = {
  database: "Database",
  redis: "Redis",
  orchestrator: "Workers",
  marketData: "Angel One session",
};

export function ReliabilityPanel({ report }: { report: ReliabilityReport }) {
  return (
    <div className="space-y-4" data-testid="reliability-panel">
      <Block title="Dependencies" section={report.health}>
        {(health) => (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {Object.entries(health.checks).map(([key, ok]) => (
              <li key={key}>
                {CHECK_LABELS[key] ?? key}: <span className={ok ? "text-bull" : "text-bear"}>{ok ? "up" : "down"}</span>
              </li>
            ))}
            {health.databaseCircuit && <li>DB circuit: <span className="font-mono">{health.databaseCircuit}</span></li>}
          </ul>
        )}
      </Block>

      <Block title="Strategy job queues" section={report.strategyJobs}>
        {(jobs) => (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Queue</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">By status</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Oldest queued</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Last completed</th>
                    <th scope="col" className="py-1.5 font-medium">Abandoned</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.queues.map((queue) => {
                    const statuses = Object.entries(queue.byStatus);
                    return (
                      <tr key={queue.kind} className="border-b border-border/60 last:border-0">
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">{queue.kind}</th>
                        <td className="py-1.5 pr-3 font-mono">
                          {statuses.length === 0 ? "no jobs" : statuses.map(([status, count]) => `${status} ${count}`).join(" · ")}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground">{queue.oldestQueuedAt ? formatIst(queue.oldestQueuedAt) : "—"}</td>
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground">{when(queue.lastCompletedAt)}</td>
                        <td className="py-1.5 font-mono">{queue.abandoned ?? "not recorded"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Retries: {jobs.retryNote}</p>
          </>
        )}
      </Block>

      <Block title="Ingestion workers (ingestion_runs)" section={report.ingestion}>
        {(ingestion) =>
          ingestion.workers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No ingestion runs recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Source / type</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Last run</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Last success</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Runs / failed</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Retries</th>
                  </tr>
                </thead>
                <tbody>
                  {ingestion.workers.map((worker) => (
                    <tr key={`${worker.source}/${worker.dataType}`} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{worker.source} / {worker.dataType}</th>
                      <td className="py-1.5 pr-3 font-mono">
                        {formatIst(worker.lastStartedAt)} <span className={worker.lastStatus === "failed" ? "text-bear" : "text-muted-foreground"}>{worker.lastStatus}</span>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-muted-foreground">{when(worker.lastSucceededAt)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{worker.runs} / {worker.failedRuns}</td>
                      <td className="py-1.5 text-right font-mono">{worker.retries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Block>

      <Block title="Dead-letter queue" section={report.deadLetterQueue}>
        {(dlq) => (
          <p className="font-mono text-xs tabular-nums">
            {dlq.pending} pending · {dlq.resolved} resolved · {dlq.pendingRetries} retries on pending
            {dlq.oldestPendingAt ? ` · oldest pending ${formatIst(dlq.oldestPendingAt)}` : ""}
            {Object.keys(dlq.bySource).length > 0 && (
              <span className="block text-muted-foreground">
                {Object.entries(dlq.bySource).map(([source, count]) => `${source} ${count}`).join(" · ")}
              </span>
            )}
          </p>
        )}
      </Block>

      <Block title="Daily candle processor" section={report.dailyProcessor}>
        {(daily) => (
          <p className="text-xs">
            Session {daily.session}:{" "}
            <span className={daily.completed ? "text-bull" : "text-amber-400"}>{daily.completed ? "completed" : "no completion recorded"}</span>
          </p>
        )}
      </Block>
    </div>
  );
}
