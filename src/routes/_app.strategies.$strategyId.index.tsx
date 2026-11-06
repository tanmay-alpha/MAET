import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { StrategyCondition, StrategyDefinition, StrategyRuleGroup } from "@shared/strategy/ast";
import { trpc, TrpcRequestError } from "@/lib/trpc";
import { RunJobDialog } from "@/components/strategy/run-job-dialog";
import { EmptyLine, ErrorLine, PageHeader, primaryButton, secondaryButton, ViewSwitch } from "@/components/strategy/page-chrome";
import { conditionText, executionRows, groupText, riskRows } from "@/components/strategy/rule-text";
import { dateTime } from "@/components/strategy/format";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { RESEARCH_TAB_FOR_KIND, type JobKind } from "@/lib/strategy-jobs";

export const Route = createFileRoute("/_app/strategies/$strategyId/")({
  head: () => ({ meta: [{ title: "Strategy — MAET Strategy Lab" }] }),
  component: StrategyWorkspace,
});

type WorkspaceView = "rules" | "versions";

const VIEWS = [
  { id: "rules", label: "Rules" },
  { id: "versions", label: "Versions" },
] as const;

interface VersionRow {
  id: string;
  versionNumber: number;
  definition: unknown;
  definitionHash: string;
  engineVersion: string;
  createdAt: string;
}

function StrategyWorkspace() {
  const { strategyId } = Route.useParams();
  const signedIn = useSignedIn();
  const [view, setView] = useState<WorkspaceView>("rules");
  const [dialogKind, setDialogKind] = useState<JobKind | null>(null);
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = trpc.strategyDefinitions.get.useQuery({ strategyId }, { enabled: signedIn });
  const strategy = data?.strategy;
  const versions: VersionRow[] = data?.versions ?? [];

  // Jobs run the latest saved version, so a new version must show up immediately.
  const createVersionMutation = trpc.strategyDefinitions.createVersion.useMutation({ onSuccess: () => refetch() });

  if (!signedIn) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Strategy" />
        <div className="p-4"><SignedOutNotice feature="Saved strategies" /></div>
      </div>
    );
  }
  if (error) {
    const notFound = error instanceof TrpcRequestError && error.code === "NOT_FOUND";
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Strategy" />
        <div className="space-y-2 p-4">
          {notFound ? <p className="text-sm text-muted-foreground">Strategy not found.</p> : <ErrorLine title="Could not load the strategy" error={error} />}
          <Link to="/strategies" className="text-xs text-primary">Back to Strategy Lab</Link>
        </div>
      </div>
    );
  }
  if (isLoading || !strategy) return <EmptyLine>Loading strategy…</EmptyLine>;

  const latest = versions[0];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={strategy.name}
        meta={
          <>
            {strategy.status.charAt(0) + strategy.status.slice(1).toLowerCase()}
            {latest ? ` · latest version v${latest.versionNumber}` : " · no saved version"}
            {strategy.description ? ` · ${strategy.description}` : ""}
          </>
        }
        actions={
          <>
            <ViewSwitch label="Strategy view" options={VIEWS} value={view} onChange={setView} />
            <Link to="/strategies/$strategyId/backtests" params={{ strategyId }} className={secondaryButton}>Research</Link>
            <Link to="/strategies/$strategyId/deployments" params={{ strategyId }} className={secondaryButton}>Deployments</Link>
            <button
              type="button"
              onClick={() => createVersionMutation.mutate({ strategyId })}
              disabled={createVersionMutation.isPending || strategy.status === "ARCHIVED"}
              className={primaryButton}
            >
              {createVersionMutation.isPending ? "Saving…" : "Save version"}
            </button>
          </>
        }
      />
      {createVersionMutation.error && (
        <div className="px-4 pt-3"><ErrorLine title="Could not save a version" error={createVersionMutation.error} /></div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "rules" ? (
          <RulesView definition={strategy.currentDraft as StrategyDefinition | undefined} latestVersion={latest?.versionNumber} onRunJob={setDialogKind} />
        ) : (
          <VersionsView versions={versions} />
        )}
      </div>

      <RunJobDialog
        kind={dialogKind}
        onOpenChange={(open) => !open && setDialogKind(null)}
        strategyId={strategyId}
        version={latest}
        onCreated={(kind, id) => {
          setDialogKind(null);
          void navigate({
            to: "/strategies/$strategyId/backtests",
            params: { strategyId },
            search: { tab: kind === "backtest" ? undefined : RESEARCH_TAB_FOR_KIND[kind], job: id },
          });
        }}
      />
    </div>
  );
}

const JOBS: ReadonlyArray<{ kind: JobKind; label: string }> = [
  { kind: "backtest", label: "Backtest" },
  { kind: "sweep", label: "Parameter sweep" },
  { kind: "walk-forward", label: "Walk-forward test" },
];

function RulesView({ definition, latestVersion, onRunJob }: {
  definition: StrategyDefinition | undefined;
  latestVersion: number | undefined;
  onRunJob: (kind: JobKind) => void;
}) {
  const settings: Array<[string, string]> = [
    ["Symbol", definition?.universe?.symbolOrId ?? "—"],
    ["Timeframe", definition?.timeframe ?? "—"],
    ["Direction", definition?.direction === "SHORT_ONLY" ? "Short only" : definition?.direction === "LONG_SHORT" ? "Long and short" : "Long only"],
  ];

  return (
    <div className="flex flex-col lg:flex-row">
      <div className="min-w-0 flex-1 space-y-4 p-4">
        <RuleSection title="Entry" group={definition?.entry} />
        <RuleSection title="Exit" group={definition?.exit} />
        <SettingsTable title="Setup" rows={settings} />
        <SettingsTable title="Risk" rows={riskRows(definition?.risk)} />
        <SettingsTable title="Execution" rows={executionRows(definition?.execution)} />
      </div>

      <aside className="space-y-4 border-t border-border p-4 lg:w-64 lg:shrink-0 lg:border-l lg:border-t-0">
        <section>
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">Run</h2>
          <div className="flex flex-wrap gap-1.5 lg:flex-col">
            {JOBS.map((job) => (
              <button
                key={job.kind}
                type="button"
                onClick={() => onRunJob(job.kind)}
                disabled={latestVersion === undefined}
                className={`${secondaryButton} lg:w-full`}
              >
                {job.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {latestVersion === undefined
              ? "Save a version first: jobs run a saved version, not the draft."
              : `Jobs run the latest saved version (v${latestVersion}).`}
          </p>
        </section>
        <section>
          <h2 className="mb-1 text-xs font-medium text-muted-foreground">Deployment</h2>
          {/* Live trading is not supported, and the paper signal evaluator does not run on the server yet. */}
          <p className="text-[11px] text-muted-foreground">Not available: live trading is unsupported and automated paper deployment is not built yet.</p>
        </section>
      </aside>
    </div>
  );
}

function RuleSection({ title, group }: { title: string; group: StrategyRuleGroup | undefined }) {
  const conditions = group?.children ?? [];
  return (
    <section>
      <h2 className="mb-1.5 flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
        {title}
        {conditions.length > 1 && <span className="font-mono">{group?.negate ? `NOT ${group.combinator}` : group?.combinator}</span>}
      </h2>
      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rules</p>
      ) : (
        <ol className="divide-y divide-border rounded border border-border bg-panel font-mono text-xs">
          {conditions.map((child: StrategyCondition | StrategyRuleGroup) => (
            <li key={child.id} className="px-3 py-1.5">
              {child.kind === "CONDITION" ? conditionText(child) : `(${groupText(child)})`}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SettingsTable({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h2>
      <dl className="grid grid-cols-1 border-l border-t border-border text-xs sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-r border-border px-3 py-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function VersionsView({ versions }: { versions: VersionRow[] }) {
  if (versions.length === 0) return <EmptyLine>No saved versions. Save version freezes the current rules so jobs can run them.</EmptyLine>;
  return (
    <table className="w-full text-xs">
      <thead className="border-b border-border bg-panel text-muted-foreground">
        <tr>
          <th className="px-4 py-2 text-left font-medium">Version</th>
          <th className="px-3 py-2 text-left font-medium">Definition hash</th>
          <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Engine</th>
          <th className="px-4 py-2 text-right font-medium">Saved (IST)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border font-mono">
        {versions.map((v) => (
          <tr key={v.id}>
            <td className="px-4 py-2">v{v.versionNumber}</td>
            <td className="px-3 py-2 text-muted-foreground" title={v.definitionHash}>{v.definitionHash.slice(0, 12)}</td>
            <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{v.engineVersion}</td>
            <td className="whitespace-nowrap px-4 py-2 text-right text-muted-foreground">{dateTime(v.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
