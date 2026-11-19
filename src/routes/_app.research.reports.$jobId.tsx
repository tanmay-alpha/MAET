import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyLine, ErrorLine, PageHeader, secondaryButton } from "@/components/strategy/page-chrome";
import { shortDate } from "@/components/strategy/format";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { researchReports } from "@/components/research-reports/api";
import { RunReportView } from "@/components/research-reports/run-report-view";

export const Route = createFileRoute("/_app/research/reports/$jobId")({
  head: () => ({ meta: [{ title: "Run report — MAET Strategy Lab" }] }),
  component: RunReportPage,
});

function RunReportPage() {
  const { jobId } = Route.useParams();
  const signedIn = useSignedIn();
  const { data: report, isLoading, error } = researchReports.getReport.useQuery({ jobId }, { enabled: signedIn, retry: false });
  const identity = report?.identity;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title={identity ? `${identity.strategyName} v${identity.versionNumber}` : "Run report"}
        meta={
          report
            ? `${report.reproducible.data.symbols.join(", ")} · ${report.reproducible.data.timeframe} · ${shortDate(report.reproducible.data.window.from)} – ${shortDate(report.reproducible.data.window.to)}`
            : "Reproducible record of one completed backtest"
        }
        actions={
          <>
            <Link to="/research/reports" className={secondaryButton}>All runs</Link>
            {identity && (
              <Link to="/strategies/$strategyId/backtests" params={{ strategyId: identity.strategyId }} search={{ job: jobId }} className={secondaryButton}>
                Open in Research
              </Link>
            )}
          </>
        }
      />
      <div className="p-4">
        {!signedIn ? (
          <SignedOutNotice feature="Run reports" />
        ) : error ? (
          <ErrorLine title="Could not load this report" error={error} />
        ) : isLoading || !report ? (
          <EmptyLine>Loading report…</EmptyLine>
        ) : (
          <RunReportView report={report} />
        )}
      </div>
    </div>
  );
}
