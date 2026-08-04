import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Code2, FlaskConical, GitBranch, Play, Save, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/strategies/$strategyId")({
  head: () => ({ meta: [{ title: "Strategy Editor — MAET" }] }),
  component: StrategyWorkspace,
});

type WorkspaceTab = "editor" | "preview" | "versions";

function StrategyWorkspace() {
  const { strategyId } = Route.useParams();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("editor");

  const { data, isLoading } = trpc.strategyDefinitions.get.useQuery({ strategyId });
  const strategy = data?.strategy;
  const versions = data?.versions ?? [];

  const createVersionMutation = trpc.strategyDefinitions.createVersion.useMutation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading strategy...</div>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-10 w-10 text-bear/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Strategy not found</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    DRAFT: "text-muted-foreground",
    VALIDATED: "text-emerald-400",
    ARCHIVED: "text-muted-foreground/50",
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Code2 className="h-5 w-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold">{strategy.name}</h1>
              <span className={`text-[10px] font-medium uppercase tracking-wide ${statusColors[strategy.status] ?? ""}`}>
                {strategy.status}
              </span>
            </div>
            {strategy.description && (
              <p className="text-xs text-muted-foreground">{strategy.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          {(["editor", "preview", "versions"] as WorkspaceTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                activeTab === tab
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "editor" ? "Rule Editor" : tab === "preview" ? "Preview" : "Versions"}
            </button>
          ))}

          {/* Actions */}
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <button
              onClick={() => createVersionMutation.mutate({ strategyId })}
              disabled={createVersionMutation.isPending || strategy.status === "ARCHIVED"}
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {createVersionMutation.isPending ? "Creating..." : "Create Version"}
            </button>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "editor" && <RuleEditorTab strategy={strategy} />}
        {activeTab === "preview" && <PreviewTab strategy={strategy} />}
        {activeTab === "versions" && <VersionsTab versions={versions} strategyId={strategyId} />}
      </div>
    </div>
  );
}

function RuleEditorTab({ strategy }: { strategy: any }) {
  const definition = strategy.currentDraft as any;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Editor panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* General */}
        <EditorSection title="General" icon={Code2}>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <div className="mt-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm">{definition?.name ?? "—"}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Direction</label>
              <div className="mt-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm">{definition?.direction ?? "LONG_ONLY"}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Timeframe</label>
              <div className="mt-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm font-mono">{definition?.timeframe ?? "1d"}</div>
            </div>
          </div>
        </EditorSection>

        {/* Universe */}
        <EditorSection title="Universe" icon={FlaskConical}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Universe Type</label>
              <div className="mt-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm">{definition?.universe?.type ?? "SINGLE_SYMBOL"}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Symbol / ID</label>
              <div className="mt-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm font-mono">{definition?.universe?.symbolOrId ?? "—"}</div>
            </div>
          </div>
        </EditorSection>

        {/* Entry Rules */}
        <EditorSection title="Entry Rules" icon={Play} badge="ENTRY">
          <RuleGroupDisplay group={definition?.entry} />
        </EditorSection>

        {/* Exit Rules */}
        <EditorSection title="Exit Rules" icon={Play} badge="EXIT">
          <RuleGroupDisplay group={definition?.exit} />
        </EditorSection>

        {/* Risk */}
        <EditorSection title="Risk Management" icon={AlertCircle}>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {definition?.risk && Object.entries(definition.risk).slice(0, 6).map(([k, v]) => (
              <div key={k}>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.replace(/([A-Z])/g, " $1")}</label>
                <div className="mt-0.5 font-mono text-xs">{String(v)}</div>
              </div>
            ))}
          </div>
        </EditorSection>
      </div>

      {/* Right panel — quick actions */}
      <div className="w-60 border-l border-border p-4 flex-shrink-0 overflow-y-auto">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</div>
        <div className="space-y-2">
          {[
            { label: "Run Backtest", icon: FlaskConical, color: "text-primary" },
            { label: "Parameter Sweep", icon: Play, color: "text-amber-400" },
            { label: "Walk-Forward Test", icon: GitBranch, color: "text-purple-400" },
          ].map((a) => (
            <button
              key={a.label}
              className="w-full flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
            >
              <a.icon className={`h-3.5 w-3.5 ${a.color}`} />
              {a.label}
            </button>
          ))}
        </div>

        <div className="mt-6 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Deployments</div>
        <button className="w-full flex items-center gap-2 rounded-md bg-primary/10 border border-primary/30 px-3 py-2 text-xs text-primary hover:bg-primary/20 transition-colors">
          <Play className="h-3.5 w-3.5" />
          Deploy Strategy
        </button>
      </div>
    </div>
  );
}

function EditorSection({ title, icon: Icon, badge, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        {badge && (
          <span className="ml-auto text-[10px] rounded border border-border px-1.5 py-0.5 uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function RuleGroupDisplay({ group }: { group: any }) {
  if (!group) {
    return <div className="text-xs text-muted-foreground italic">No rules defined</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono">
          {group.combinator}
        </span>
        {group.negate && <span className="text-bear text-[10px]">NOT</span>}
        <span className="text-muted-foreground">{group.children?.length ?? 0} conditions</span>
      </div>
      <div className="pl-3 border-l border-border space-y-1.5">
        {(group.children ?? []).map((child: any, i: number) => (
          <div key={i}>
            {child.kind === "CONDITION" ? (
              <ConditionDisplay condition={child} />
            ) : (
              <RuleGroupDisplay group={child} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConditionDisplay({ condition }: { condition: any }) {
  const leftStr = operandToString(condition.left);
  const rightStr = operandToString(condition.right);
  return (
    <div className="flex items-center gap-2 rounded bg-background px-3 py-2 text-xs font-mono">
      <span className="text-blue-400">{leftStr}</span>
      <span className="text-muted-foreground">{condition.operator.toLowerCase().replace(/_/g, " ")}</span>
      <span className="text-amber-400">{rightStr}</span>
    </div>
  );
}

function operandToString(op: any): string {
  if (!op) return "?";
  if (op.kind === "CONSTANT") return String(op.value);
  if (op.kind === "PRICE") return `${op.field}${op.lag ? `[${op.lag}]` : ""}`;
  if (op.kind === "INDICATOR") {
    const params = Object.entries(op.params ?? {}).map(([k, v]) => `${k}=${v}`).join(",");
    return `${op.indicator}(${params})${op.lag ? `[${op.lag}]` : ""}`;
  }
  return "?";
}

function PreviewTab({ strategy }: { strategy: any }) {
  const definition = strategy.currentDraft as any;
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="font-medium mb-1">Strategy Summary</h2>
          <p className="text-sm text-muted-foreground">Human-readable interpretation of the rule tree</p>
        </div>

        <div className="rounded-lg border border-border bg-panel p-4 text-sm space-y-2">
          <div className="font-medium">{definition?.name ?? "Unnamed Strategy"}</div>
          <div className="text-muted-foreground">
            Direction: <span className="text-foreground">{definition?.direction ?? "LONG_ONLY"}</span>
            {" | "}Timeframe: <span className="text-foreground font-mono">{definition?.timeframe ?? "1d"}</span>
            {" | "}Universe: <span className="text-foreground font-mono">{definition?.universe?.symbolOrId ?? "—"}</span>
          </div>
        </div>

        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-xs font-medium text-emerald-400 uppercase tracking-wide mb-2">Entry Logic</div>
          <div className="text-sm">{describeGroup(definition?.entry)}</div>
        </div>

        <div className="rounded-lg border border-bear/20 bg-bear/5 p-4">
          <div className="text-xs font-medium text-bear uppercase tracking-wide mb-2">Exit Logic</div>
          <div className="text-sm">{describeGroup(definition?.exit)}</div>
        </div>
      </div>
    </div>
  );
}

function describeGroup(group: any): string {
  if (!group || !group.children || group.children.length === 0) return "No rules defined";
  const parts = group.children.map((child: any) => {
    if (child.kind === "CONDITION") {
      return `${operandToString(child.left)} ${child.operator.toLowerCase().replace(/_/g, " ")} ${operandToString(child.right)}`;
    }
    return `(${describeGroup(child)})`;
  });
  const joined = parts.join(group.combinator === "AND" ? " AND " : " OR ");
  return group.negate ? `NOT (${joined})` : joined;
}

function VersionsTab({ versions, strategyId }: { versions: any[]; strategyId: string }) {
  return (
    <div className="h-full overflow-y-auto p-4">
      {versions.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border">
          <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No versions yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">Create a version from the editor header</p>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((v: any) => (
            <div key={v.id} className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">v{v.versionNumber}</span>
                  <span className="text-xs text-muted-foreground font-mono truncate">{v.definitionHash?.slice(0, 12)}…</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Engine {v.engineVersion} · {new Date(v.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-emerald-400">Immutable</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
