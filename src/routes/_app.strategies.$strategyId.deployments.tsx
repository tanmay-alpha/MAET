import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { EmptyLine, ErrorLine, PageHeader, secondaryButton, ViewSwitch } from "@/components/strategy/page-chrome";
import { dateTime } from "@/components/strategy/format";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";

export const Route = createFileRoute("/_app/strategies/$strategyId/deployments")({
  head: () => ({ meta: [{ title: "Deployments — MAET Strategy Lab" }] }),
  component: DeploymentPage,
});

const MODES: Record<string, { label: string; desc: string }> = {
  OFF: { label: "Off", desc: "Evaluation disabled." },
  ALERT_ONLY: { label: "Alert only", desc: "Signals raise alerts; no orders are created." },
  MANUAL_CONFIRM: { label: "Manual confirm", desc: "Proposed paper orders wait for your confirmation." },
  AUTO_PAPER: { label: "Auto paper", desc: "Signals place paper orders, subject to the risk gate." },
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "text-bull",
  PAUSED: "text-amber-400",
  STOPPED: "text-muted-foreground/60",
  ERROR: "text-bear",
};

/** strategy_deployments row as JSON. */
interface DeploymentRow {
  id: string;
  strategyVersionId: string;
  mode: string;
  universe: string;
  timeframe: string;
  status: string;
  userKillSwitch: boolean;
  lastEvaluatedAt: string | null;
  lastSignalAt: string | null;
}

interface SignalRow {
  id: string;
  signalType: string;
  symbol: string;
  barCloseTimestamp: string;
  createdAt: string;
}

interface DecisionRow {
  id: string;
  decision: string;
  reasonCode: string | null;
  createdAt: string;
}

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

function DeploymentPage() {
  const { strategyId } = Route.useParams();
  const signedIn = useSignedIn();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: stratData } = trpc.strategyDefinitions.get.useQuery({ strategyId }, { enabled: signedIn });
  const { data: deplData, error, refetch } = trpc.strategyDeployments.list.useQuery(undefined, { enabled: signedIn });
  // list returns every deployment of the user; keep the ones running a version of this strategy.
  const versionIds = new Set<string>((stratData?.versions ?? []).map((v: { id: string }) => v.id));
  const versionNumbers = new Map<string, number>((stratData?.versions ?? []).map((v: { id: string; versionNumber: number }) => [v.id, v.versionNumber]));
  const deployments = ((deplData?.deployments ?? []) as DeploymentRow[]).filter((d) => versionIds.has(d.strategyVersionId));

  const onSuccess = () => refetch();
  const killMutation = trpc.strategyDeployments.toggleKillSwitch.useMutation({ onSuccess });
  const pauseMutation = trpc.strategyDeployments.pause.useMutation({ onSuccess });
  const stopMutation = trpc.strategyDeployments.stop.useMutation({ onSuccess });
  const activateMutation = trpc.strategyDeployments.activate.useMutation({ onSuccess });
  const actionError = killMutation.error ?? pauseMutation.error ?? stopMutation.error ?? activateMutation.error;

  const selected = deployments.find((d) => d.id === selectedId);
  const { data: signalsData } = trpc.strategyDeployments.getSignals.useQuery(
    { deploymentId: selectedId!, limit: 50 },
    { enabled: !!selected },
  );
  const { data: decisionsData } = trpc.strategyDeployments.getDecisions.useQuery(
    { deploymentId: selectedId!, limit: 50 },
    { enabled: !!selected },
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto md:overflow-hidden">
      <PageHeader
        title="Deployments"
        meta={
          <>
            <Link to="/strategies/$strategyId" params={{ strategyId }} className="hover:text-foreground">{stratData?.strategy?.name ?? "Strategy"}</Link>
            {" · paper only"}
          </>
        }
        actions={<Link to="/strategies/$strategyId/backtests" params={{ strategyId }} className={secondaryButton}>Research</Link>}
      />
      {/* No form creates deployments, and the hosted server does not start the strategy-evaluator worker (docs/ARCHITECTURE.md §1). */}
      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        Deployments are created through the API; the hosted server does not run the signal evaluator, so they record no new signals.
        The kill switch stops all execution for a deployment immediately.
      </p>

      {!signedIn ? (
        <div className="p-4"><SignedOutNotice feature="Strategy deployments" /></div>
      ) : (
        <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
          <div className="shrink-0 border-b border-border md:w-72 md:overflow-y-auto md:border-b-0 md:border-r">
            {error ? (
              <div className="p-3"><ErrorLine title="Could not load deployments" error={error} /></div>
            ) : deployments.length === 0 ? (
              <EmptyLine>No deployments for this strategy.</EmptyLine>
            ) : (
              <ul className="divide-y divide-border">
                {deployments.map((d) => (
                  <li key={d.id} className={selectedId === d.id ? "bg-accent" : "hover:bg-accent/40"}>
                    <button type="button" aria-current={selectedId === d.id} onClick={() => setSelectedId(d.id)} className="w-full px-3 py-2 text-left">
                      <span className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium">{MODES[d.mode]?.label ?? titleCase(d.mode)}</span>
                        <span className={STATUS_TONE[d.status] ?? "text-muted-foreground"}>{titleCase(d.status)}</span>
                      </span>
                      <span className="mt-0.5 flex justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                        <span className="truncate">{d.universe} · {d.timeframe} · v{versionNumbers.get(d.strategyVersionId) ?? "?"}</span>
                        {d.userKillSwitch && <span className="font-sans text-bear">Kill switch on</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0 p-4 md:flex-1 md:overflow-y-auto">
            {actionError && <div className="mb-3"><ErrorLine title="Action failed" error={actionError} /></div>}
            {selected ? (
              <DeploymentDetail
                deployment={selected}
                signals={signalsData?.signals ?? []}
                decisions={decisionsData?.decisions ?? []}
                onKillSwitch={(enabled) => killMutation.mutate({ deploymentId: selected.id, enabled })}
                onPause={() => pauseMutation.mutate({ deploymentId: selected.id })}
                onStop={() => stopMutation.mutate({ deploymentId: selected.id })}
                onActivate={() => activateMutation.mutate({ deploymentId: selected.id })}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a deployment to see its signals and execution decisions.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DeploymentDetail({ deployment, signals, decisions, onKillSwitch, onPause, onStop, onActivate }: {
  deployment: DeploymentRow;
  signals: SignalRow[];
  decisions: DecisionRow[];
  onKillSwitch: (enabled: boolean) => void;
  onPause: () => void;
  onStop: () => void;
  onActivate: () => void;
}) {
  const mode = MODES[deployment.mode] ?? { label: titleCase(deployment.mode), desc: "" };
  const [view, setView] = useState<"signals" | "decisions">("signals");

  return (
    <div className="max-w-3xl space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded border border-border bg-panel p-3">
        <div className="text-xs">
          <div className="text-sm font-medium">
            {mode.label} · <span className={STATUS_TONE[deployment.status] ?? "text-muted-foreground"}>{titleCase(deployment.status)}</span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{mode.desc}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Last evaluated {dateTime(deployment.lastEvaluatedAt)} · last signal {dateTime(deployment.lastSignalAt)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {deployment.status === "DRAFT" || deployment.status === "PAUSED" ? (
            <button type="button" onClick={onActivate} className={secondaryButton}>Activate</button>
          ) : deployment.status === "ACTIVE" ? (
            <button type="button" onClick={onPause} className={secondaryButton}>Pause</button>
          ) : null}
          <button
            type="button"
            onClick={onStop}
            disabled={deployment.status === "STOPPED"}
            className={`${secondaryButton} border-bear/40 text-bear hover:text-bear`}
          >
            Stop
          </button>
        </div>
      </section>

      <section className="flex items-center justify-between gap-3 rounded border border-border bg-panel p-3 text-xs">
        <div>
          <div className="text-sm font-medium">Kill switch</div>
          <p className="text-muted-foreground">Halts every execution decision for this deployment. Always available.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={deployment.userKillSwitch}
          aria-label="Kill switch"
          onClick={() => onKillSwitch(!deployment.userKillSwitch)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${deployment.userKillSwitch ? "bg-bear" : "bg-border"}`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${deployment.userKillSwitch ? "translate-x-4.5" : "translate-x-0.5"}`} />
        </button>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">Recent activity</h3>
          <ViewSwitch
            label="Activity"
            options={[{ id: "signals", label: `Signals (${signals.length})` }, { id: "decisions", label: `Decisions (${decisions.length})` }]}
            value={view}
            onChange={setView}
          />
        </div>
        {view === "signals" ? (
          signals.length === 0 ? (
            <EmptyLine>No signals recorded.</EmptyLine>
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full whitespace-nowrap text-xs">
                <thead className="border-b border-border bg-panel text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Signal</th>
                    <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
                    <th className="px-3 py-1.5 text-left font-medium">Bar close (IST)</th>
                    <th className="px-3 py-1.5 text-left font-medium">Recorded (IST)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {signals.map((s) => (
                    <tr key={s.id}>
                      <td className={`px-3 py-1.5 ${s.signalType.includes("ENTRY") ? "text-bull" : "text-bear"}`}>{titleCase(s.signalType)}</td>
                      <td className="px-3 py-1.5 font-mono">{s.symbol}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{dateTime(s.barCloseTimestamp)}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{dateTime(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : decisions.length === 0 ? (
          <EmptyLine>No execution decisions recorded.</EmptyLine>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full whitespace-nowrap text-xs">
              <thead className="border-b border-border bg-panel text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Decision</th>
                  <th className="px-3 py-1.5 text-left font-medium">Reason</th>
                  <th className="px-3 py-1.5 text-left font-medium">Recorded (IST)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {decisions.map((d) => (
                  <tr key={d.id}>
                    <td className={`px-3 py-1.5 ${d.decision.includes("REJECTED") ? "text-bear" : "text-bull"}`}>{titleCase(d.decision)}</td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-muted-foreground" title={d.reasonCode ?? undefined}>{d.reasonCode ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{dateTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
