import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Play, Pause, Square, Zap, AlertTriangle,
  ShieldAlert, CheckCircle, Clock, Activity,
  XCircle, ChevronDown, Info,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/strategies/$strategyId/deployments")({
  head: () => ({ meta: [{ title: "Deployments — MAET Strategy Lab" }] }),
  component: DeploymentPage,
});

const MODE_DESCRIPTIONS: Record<string, { label: string; color: string; icon: typeof Play; desc: string }> = {
  OFF: {
    label: "Off",
    color: "text-muted-foreground",
    icon: Square,
    desc: "Strategy evaluation is disabled",
  },
  ALERT_ONLY: {
    label: "Alert Only",
    color: "text-amber-400",
    icon: Zap,
    desc: "Signals fire alerts — no orders created",
  },
  MANUAL_CONFIRM: {
    label: "Manual Confirm",
    color: "text-blue-400",
    icon: CheckCircle,
    desc: "Proposed orders require your confirmation before paper execution",
  },
  AUTO_PAPER: {
    label: "Auto Paper",
    color: "text-primary",
    icon: Play,
    desc: "Signals automatically create paper orders — subject to risk gate",
  },
};

function DeploymentPage() {
  const { strategyId } = Route.useParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: stratData } = trpc.strategyDefinitions.get.useQuery({ strategyId });
  const { data: deplData, refetch } = trpc.strategyDeployments.list.useQuery();
  const deployments = (deplData?.deployments ?? []).filter(
    (d: any) => d.strategyVersionId,
  );

  const killMutation = trpc.strategyDeployments.toggleKillSwitch.useMutation({
    onSuccess: () => refetch(),
  });
  const pauseMutation = trpc.strategyDeployments.pause.useMutation({ onSuccess: () => refetch() });
  const stopMutation = trpc.strategyDeployments.stop.useMutation({ onSuccess: () => refetch() });
  const activateMutation = trpc.strategyDeployments.activate.useMutation({ onSuccess: () => refetch() });

  const selectedDeployment = deployments.find((d: any) => d.id === selectedId);
  const { data: signalsData } = trpc.strategyDeployments.getSignals.useQuery(
    { deploymentId: selectedId!, limit: 50 },
    { enabled: !!selectedId },
  );
  const { data: decisionsData } = trpc.strategyDeployments.getDecisions.useQuery(
    { deploymentId: selectedId!, limit: 50 },
    { enabled: !!selectedId },
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-semibold">Deployments</h1>
            <p className="text-xs text-muted-foreground">{stratData?.strategy?.name ?? "Strategy"}</p>
          </div>
          <span className="text-[10px] rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary uppercase tracking-wide">
            Paper Only
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/strategies/$strategyId"
            params={{ strategyId }}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2.5 py-1.5"
          >
            Editor →
          </Link>
          <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            <Play className="h-3.5 w-3.5" />
            New Deployment
          </button>
        </div>
      </div>

      {/* Risk disclosure banner */}
      <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/5 px-5 py-2 text-xs text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <strong>Paper trading only.</strong> AUTO_PAPER mode creates simulated orders in your paper account.
          No real money is at risk. Kill switch disables all execution immediately.
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Deployment list */}
        <div className="w-72 border-r border-border overflow-y-auto p-3 flex-shrink-0">
          {deployments.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <Info className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No deployments yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {deployments.map((d: any) => {
                const mode = MODE_DESCRIPTIONS[d.mode] ?? MODE_DESCRIPTIONS.OFF;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedId === d.id ? "border-primary bg-primary/10" : "border-border hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <mode.icon className={`h-3.5 w-3.5 ${mode.color}`} />
                      <span className={`text-xs font-medium ${mode.color}`}>{mode.label}</span>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">{d.timeframe}</div>
                    {d.userKillSwitch && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-bear">
                        <ShieldAlert className="h-3 w-3" />
                        Kill Switch Active
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-5">
          {selectedDeployment ? (
            <DeploymentDetail
              deployment={selectedDeployment}
              signals={signalsData?.signals ?? []}
              decisions={decisionsData?.decisions ?? []}
              onKillSwitch={(e: boolean) =>
                killMutation.mutate({ deploymentId: selectedDeployment.id, enabled: e })
              }
              onPause={() => pauseMutation.mutate({ deploymentId: selectedDeployment.id })}
              onStop={() => stopMutation.mutate({ deploymentId: selectedDeployment.id })}
              onActivate={() => activateMutation.mutate({ deploymentId: selectedDeployment.id })}
            />
          ) : (
            <div className="flex h-48 flex-col items-center justify-center">
              <Activity className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Select a deployment to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: "text-muted-foreground border-border",
    ACTIVE: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
    PAUSED: "text-amber-400 border-amber-400/30",
    STOPPED: "text-muted-foreground/50 border-border/50",
    ERROR: "text-bear border-bear/30 bg-bear/5",
  };
  return (
    <span className={`ml-auto text-[10px] rounded border px-1.5 py-0.5 uppercase tracking-wide ${colors[status] ?? colors.DRAFT}`}>
      {status}
    </span>
  );
}

function DeploymentDetail({ deployment, signals, decisions, onKillSwitch, onPause, onStop, onActivate }: {
  deployment: any;
  signals: any[];
  decisions: any[];
  onKillSwitch: (e: boolean) => void;
  onPause: () => void;
  onStop: () => void;
  onActivate: () => void;
}) {
  const mode = MODE_DESCRIPTIONS[deployment.mode] ?? MODE_DESCRIPTIONS.OFF;
  const [showDecisions, setShowDecisions] = useState(false);

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Mode + controls */}
      <div className="flex items-start gap-4 rounded-lg border border-border bg-panel p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <mode.icon className={`h-4 w-4 ${mode.color}`} />
            <span className={`font-medium ${mode.color}`}>{mode.label}</span>
            <StatusBadge status={deployment.status} />
          </div>
          <p className="text-xs text-muted-foreground">{mode.desc}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {deployment.status === "DRAFT" || deployment.status === "PAUSED" ? (
            <button
              onClick={onActivate}
              className="flex items-center gap-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/20"
            >
              <Play className="h-3 w-3" />
              Activate
            </button>
          ) : deployment.status === "ACTIVE" ? (
            <button
              onClick={onPause}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pause className="h-3 w-3" />
              Pause
            </button>
          ) : null}
          <button
            onClick={onStop}
            disabled={deployment.status === "STOPPED"}
            className="flex items-center gap-1.5 rounded border border-bear/30 px-2.5 py-1.5 text-xs text-bear hover:bg-bear/10 disabled:opacity-30"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        </div>
      </div>

      {/* Kill switch */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              <ShieldAlert className={`h-4 w-4 ${deployment.userKillSwitch ? "text-bear" : "text-muted-foreground"}`} />
              User Kill Switch
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Immediately halts all execution decisions. Always available.
            </p>
          </div>
          <button
            onClick={() => onKillSwitch(!deployment.userKillSwitch)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              deployment.userKillSwitch ? "bg-bear" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                deployment.userKillSwitch ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Recent signals */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Recent Signals ({signals.length})</h3>
          <button
            onClick={() => setShowDecisions(!showDecisions)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showDecisions ? "Show Signals" : "Show Decisions"}
          </button>
        </div>

        {!showDecisions ? (
          signals.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
              No signals yet
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-panel border-b border-border">
                  <tr>
                    {["Type", "Symbol", "Bar Close", "Timestamp"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {signals.map((s: any) => (
                    <tr key={s.id} className="hover:bg-panel/60">
                      <td className="px-3 py-2">
                        <span className={s.signalType.includes("ENTRY") ? "text-bull" : "text-bear"}>
                          {s.signalType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{s.symbol}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(s.barCloseTimestamp).toLocaleString()}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(s.createdAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          decisions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
              No execution decisions yet
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-panel border-b border-border">
                  <tr>
                    {["Decision", "Reason", "Timestamp"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {decisions.map((d: any) => (
                    <tr key={d.id} className="hover:bg-panel/60">
                      <td className="px-3 py-2">
                        <span className={d.decision.includes("REJECTED") ? "text-bear" : "text-bull"}>
                          {d.decision}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">{d.reasonCode}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(d.createdAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
