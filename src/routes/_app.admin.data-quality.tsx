import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { AuthenticationError, trpc, TrpcRequestError } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { fetchMarketQuotes } from "@/lib/market-api";
import { quoteSourceLabel } from "@/lib/quote-source";
import { useSignedIn } from "@/hooks/use-signed-in";
import { IngestionBatches } from "@/components/data-quality/ingestion-batches";
import { ReliabilityPanel } from "@/components/data-quality/reliability-panel";

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

function isAccessDenied(error: unknown): boolean {
  return error instanceof AuthenticationError ||
    (error instanceof TrpcRequestError && (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED"));
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

  const reliabilityQuery = useQuery({
    queryKey: ["dataQuality", "getReliability"],
    queryFn: () => trpc.dataQuality.getReliability.query(),
    retry: false,
    enabled: signedIn,
  });
  const batchesQuery = useQuery({
    queryKey: ["dataQuality", "getOverview"],
    queryFn: () => trpc.dataQuality.getOverview.query(),
    retry: false,
    enabled: signedIn,
  });
  const retryMutation = useMutation({
    mutationFn: (batchId: string) => trpc.dataQuality.retryBatch.mutate({ batchId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dataQuality"] }),
  });

  const health = healthQuery.data;
  const checks = health?.checks;
  const quotes = quotesQuery.data;
  const quotedCount = quotes?.quotes.length ?? 0;
  const checkedAt = healthQuery.dataUpdatedAt || quotesQuery.dataUpdatedAt;

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

        <p className="pt-3 text-xs text-muted-foreground">
          Per-symbol freshness, gaps and invalid bars:{" "}
          <Link to="/data-quality" className="text-primary hover:underline">Market data quality</Link>.
        </p>

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

        <Section title="Reliability">
          {!signedIn ? (
            <p className="text-xs text-muted-foreground">Job queues, ingestion runs and dead-letter stats are visible to admin accounts.</p>
          ) : reliabilityQuery.isError ? (
            <p className="text-xs text-muted-foreground">
              {isAccessDenied(reliabilityQuery.error) ? "Reliability details are visible to admin accounts only." : "Reliability details are unavailable right now."}
            </p>
          ) : !reliabilityQuery.data ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <ReliabilityPanel report={reliabilityQuery.data} />
          )}
        </Section>

        <Section title="Ingestion batches">
          {!signedIn ? (
            <p className="text-xs text-muted-foreground">Ingestion batches are visible to admin accounts.</p>
          ) : batchesQuery.isError ? (
            <p className="text-xs text-muted-foreground">
              {isAccessDenied(batchesQuery.error) ? "Ingestion batches are visible to admin accounts only." : "Ingestion batches are unavailable right now."}
            </p>
          ) : !batchesQuery.data ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <IngestionBatches batches={batchesQuery.data.recentBatches} onRetryBatch={(batchId) => retryMutation.mutate(batchId)} />
          )}
        </Section>
      </div>
    </div>
  );
}
