import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyLine, ErrorLine, PageHeader, secondaryButton } from "@/components/strategy/page-chrome";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { researchReports } from "@/components/research-reports/api";
import { ComparisonView } from "@/components/research-reports/comparison-view";
import { compareRunIds, MAX_COMPARE_RUNS, MIN_COMPARE_RUNS, parseCompareSearch } from "@/components/research-reports/selection";

export const Route = createFileRoute("/_app/research/reports/compare")({
  validateSearch: parseCompareSearch,
  head: () => ({ meta: [{ title: "Compare runs — MAET Strategy Lab" }] }),
  component: CompareRunsPage,
});

function CompareRunsPage() {
  const runs = compareRunIds(Route.useSearch().runs);
  const signedIn = useSignedIn();
  const enough = runs.length >= MIN_COMPARE_RUNS;
  const { data, isLoading, error } = researchReports.compare.useQuery({ jobIds: runs }, { enabled: signedIn && enough, retry: false });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Compare runs"
        meta="Equity, drawdown and costs over the dates every selected run covers"
        actions={<Link to="/research/reports" className={secondaryButton}>Change selection</Link>}
      />
      <div className="p-4">
        {!signedIn ? (
          <SignedOutNotice feature="Run comparisons" />
        ) : !enough ? (
          <EmptyLine>Pick {MIN_COMPARE_RUNS}-{MAX_COMPARE_RUNS} completed runs on the Run reports page to compare them.</EmptyLine>
        ) : error ? (
          <ErrorLine title="Could not compare these runs" error={error} />
        ) : isLoading || !data ? (
          <EmptyLine>Comparing runs…</EmptyLine>
        ) : (
          <ComparisonView comparison={data} />
        )}
      </div>
    </div>
  );
}
