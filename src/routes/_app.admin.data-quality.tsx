import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { DataQualityOverviewComponent } from "@/components/data-quality/data-quality-overview";

export const Route = createFileRoute("/_app/admin/data-quality")({
  head: () => ({ meta: [{ title: "Data Quality Centre — MAET Admin" }] }),
  component: AdminDataQualityPage,
});

function AdminDataQualityPage() {
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["dataQuality", "getOverview"],
    queryFn: () => trpc.dataQuality.getOverview.query(),
    retry: false,
  });

  const coverageQuery = useQuery({
    queryKey: ["dataQuality", "getCoverage"],
    queryFn: () => trpc.dataQuality.getCoverage.query(),
    retry: false,
  });

  const anomaliesQuery = useQuery({
    queryKey: ["dataQuality", "listAnomalies"],
    queryFn: () => trpc.dataQuality.listAnomalies.query(),
    retry: false,
  });

  const retryMutation = useMutation({
    mutationFn: (batchId: string) => trpc.dataQuality.retryBatch.mutate({ batchId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataQuality"] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (anomalyId: string) => trpc.dataQuality.resolveAnomaly.mutate({ anomalyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataQuality"] });
    },
  });

  if (overviewQuery.isError) {
    return (
      <div className="container mx-auto max-w-4xl p-12 text-center">
        <h2 className="text-2xl font-bold text-destructive">Access Restricted</h2>
        <p className="text-muted-foreground mt-2">Data Quality Centre is available to admin users only.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Data Quality Centre</h1>
        <p className="text-muted-foreground">Monitor ingestion audit trails, anomaly flags, and pipeline health.</p>
      </div>

      <DataQualityOverviewComponent
        overview={overviewQuery.data ?? null}
        coverage={coverageQuery.data ?? null}
        onRetryBatch={(batchId) => retryMutation.mutate(batchId)}
      />

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Detected Data Anomalies</h3>
        <div className="space-y-3">
          {anomaliesQuery.data?.items?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open data anomalies found.</p>
          ) : (
            anomaliesQuery.data?.items?.map((anom: any) => (
              <div key={anom.id} className="flex items-center justify-between border-b pb-3 text-xs">
                <div>
                  <span className="font-semibold">{anom.checkType}</span>
                  <span className="ml-2 text-muted-foreground">({anom.dataType} - {anom.severity})</span>
                  <p className="text-muted-foreground">{anom.description}</p>
                </div>
                {!anom.isResolved && (
                  <button
                    onClick={() => resolveMutation.mutate(anom.id)}
                    className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded"
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
