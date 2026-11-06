import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { AuthenticationError, trpc, TrpcRequestError } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { fetchMarketQuotes } from "@/lib/market-api";
import { quoteSourceLabel } from "@/lib/quote-source";
import { useSignedIn } from "@/hooks/use-signed-in";
import { DataQualityOverviewComponent } from "@/components/data-quality/data-quality-overview";

export const Route = createFileRoute("/_app/admin/data-quality")({
  head: () => ({ meta: [{ title: "Data status — MAET" }] }),
  component: DataStatusPage,
});

/** Public body of GET /api/health (server/infra/health.ts). */
type HealthReport = {
  status: "ok" | "degraded";
  version?: string;
  checks: { database: boolean; redis: boolean; orchestrator: boolean; marketData: boolean };
};

type DataAnomaly = {
  id: string;
  checkType: string;
  dataType: string;
  severity: string;
  description: string;
  isResolved: boolean;
};

const PROBE_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS"];

async function fetchHealth(signal: AbortSignal): Promise<HealthReport> {
  const response = await fetch(apiUrl("/api/health"), { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Health check returned ${response.status}`);
  return (await response.json()) as HealthReport;
}

function Row({ label, ok, detail }: { label: string; ok: boolean | undefined; detail: string }) {
  const state = ok === undefined ? "—" : ok ? "up" : "down";
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-1.5 pr-4">{label}</td>
      <td className={`w-16 py-1.5 pr-4 font-mono ${ok === undefined ? "text-muted-foreground" : ok ? "text-bull" : "text-bear"}`}>{state}</td>
      <td className="py-1.5 text-muted-foreground">{detail}</td>
    </tr>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border py-4 last:border-b-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function DataStatusPage() {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();

  const healthQuery = useQuery({
    queryKey: ["dataStatus", "health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: false,
    refetchInterval: 30_000,
  });
  const quotesQuery = useQuery({
    queryKey: ["dataStatus", "quotes"],
    queryFn: ({ signal }) => fetchMarketQuotes(PROBE_SYMBOLS, signal),
    retry: false,
    refetchInterval: 30_000,
  });

  const overviewQuery = useQuery({
    queryKey: ["dataQuality", "getOverview"],
    queryFn: () => trpc.dataQuality.getOverview.query(),
    retry: false,
    enabled: signedIn,
  });
  const coverageQuery = useQuery({
    queryKey: ["dataQuality", "getCoverage"],
    queryFn: () => trpc.dataQuality.getCoverage.query(),
    retry: false,
    enabled: signedIn,
  });
  const anomaliesQuery = useQuery({
    queryKey: ["dataQuality", "listAnomalies"],
    queryFn: () => trpc.dataQuality.listAnomalies.query(),
    retry: false,
    enabled: signedIn,
  });

  const retryMutation = useMutation({
    mutationFn: (batchId: string) => trpc.dataQuality.retryBatch.mutate({ batchId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dataQuality"] }),
  });
  const resolveMutation = useMutation({
    mutationFn: (anomalyId: string) => trpc.dataQuality.resolveAnomaly.mutate({ anomalyId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dataQuality"] }),
  });

  const health = healthQuery.data;
  const checks = health?.checks;
  const quotes = quotesQuery.data;
  const quotedCount = quotes?.quotes.length ?? 0;
  const anomalies: DataAnomaly[] = anomaliesQuery.data?.items ?? [];
  const checkedAt = healthQuery.dataUpdatedAt || quotesQuery.dataUpdatedAt;
  const adminError = overviewQuery.error;
  const notAdmin = adminError instanceof AuthenticationError ||
    (adminError instanceof TrpcRequestError && (adminError.code === "FORBIDDEN" || adminError.code === "UNAUTHORIZED"));

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-3">
          <h1 className="text-xl font-semibold">Data status</h1>
          {checkedAt > 0 && (
            <span className="font-mono text-xs text-muted-foreground">checked {new Date(checkedAt).toLocaleTimeString("en-IN", { hour12: false })}</span>
          )}
          <button
            type="button"
            onClick={() => {
              void healthQuery.refetch();
              void quotesQuery.refetch();
            }}
            className="ml-auto rounded border border-border p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Check again"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${healthQuery.isFetching || quotesQuery.isFetching ? "animate-spin" : ""}`} />
          </button>
        </header>

        <Section
          title="Backend"
          aside={health?.version && <span className="font-mono text-[11px] text-muted-foreground">build {health.version.slice(0, 7)}</span>}
        >
          {healthQuery.isError ? (
            <p role="status" className="text-sm text-bear">Backend health check unreachable from this page.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <tbody>
                  <Row label="Database" ok={checks?.database} detail="Paper accounts, saved work, fundamentals, stored candles" />
                  <Row label="Redis" ok={checks?.redis} detail="Cache and rate limits" />
                  <Row label="Angel One session" ok={checks?.marketData} detail="Live NSE ticks for the paper engine and alerts" />
                  <Row label="Workers" ok={checks?.orchestrator} detail="Order matching, alerts, candle writer" />
                </tbody>
              </table>
              {checks && !checks.database && (
                <p role="status" className="mt-2 text-xs text-amber-300/90">
                  Database offline: sign-in features and stored fundamentals are unavailable. Quotes, charts and the NSE company list still load.
                </p>
              )}
            </>
          )}
        </Section>

        <Section title="Quotes">
          <p className="text-sm">
            {quotesQuery.isError
              ? <span className="text-bear">Quote service unavailable.</span>
              : quotes
                ? <>{quoteSourceLabel(quotes.source, quotes.delayed, quotes.marketPhase)} <span className="text-muted-foreground">· {quotedCount} of {PROBE_SYMBOLS.length} sample quotes ({PROBE_SYMBOLS.join(", ")}) returned</span></>
                : <span className="text-muted-foreground">Checking…</span>}
          </p>
        </Section>

        <Section title="Sources">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Quotes</dt>
            <dd>Angel One SmartAPI when the backend holds a session, otherwise Yahoo Finance (delayed). Outside NSE market hours every quote is delayed.</dd>
            <dt className="text-muted-foreground">Candles</dt>
            <dd>Stored candles from the database, otherwise Yahoo Finance.</dd>
            <dt className="text-muted-foreground">Companies</dt>
            <dd>NSE equity master list; sector and market cap from stored Yahoo Finance fundamentals.</dd>
            <dt className="text-muted-foreground">Options</dt>
            <dd>Angel One NFO contracts and quotes, stored by the ingestion worker.</dd>
          </dl>
        </Section>

        <Section title="Ingestion audits">
          {!signedIn ? (
            <p className="text-xs text-muted-foreground">Ingestion audits and anomalies are visible to admin accounts.</p>
          ) : overviewQuery.isError ? (
            <p className="text-xs text-muted-foreground">
              {notAdmin ? "Ingestion audits are visible to admin accounts only." : "Ingestion audits are unavailable right now."}
            </p>
          ) : overviewQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              <DataQualityOverviewComponent
                overview={overviewQuery.data ?? null}
                coverage={coverageQuery.data ?? null}
                onRetryBatch={(batchId) => retryMutation.mutate(batchId)}
              />
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">Open anomalies</h3>
                {anomalies.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None.</p>
                ) : (
                  <ul className="text-xs">
                    {anomalies.map((anomaly) => (
                      <li key={anomaly.id} className="flex items-start justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
                        <div>
                          <span className="font-medium">{anomaly.checkType}</span>
                          <span className="ml-2 text-muted-foreground">{anomaly.dataType} · {anomaly.severity}</span>
                          <p className="text-muted-foreground">{anomaly.description}</p>
                        </div>
                        {!anomaly.isResolved && (
                          <button
                            type="button"
                            onClick={() => resolveMutation.mutate(anomaly.id)}
                            className="shrink-0 rounded border border-border px-2 py-0.5 hover:bg-accent"
                          >
                            Resolve
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
