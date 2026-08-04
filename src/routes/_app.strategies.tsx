import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Layers, Plus, FlaskConical, Play, GitBranch,
  BookOpen, Archive, TrendingUp, Activity, Zap,
  ChevronRight, Code2, BarChart3,
} from "lucide-react";
import {
  STRATEGY_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_CATEGORY_COLORS,
  type StrategyTemplate,
} from "@/components/strategy/strategy-library";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/strategies")({
  head: () => ({ meta: [{ title: "Strategy Lab — MAET" }] }),
  component: StrategyLab,
});

type LabTab = "library" | "my-strategies" | "new";

function StrategyLab() {
  const [activeTab, setActiveTab] = useState<LabTab>("library");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Strategy Lab</h1>
          <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary uppercase tracking-wide">
            Paper Only
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(["library", "my-strategies", "new"] as LabTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                activeTab === tab
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "library" ? "Strategy Library" : tab === "my-strategies" ? "My Strategies" : "New Strategy"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "library" && <StrategyLibraryTab />}
        {activeTab === "my-strategies" && <MyStrategiesTab />}
        {activeTab === "new" && <NewStrategyTab />}
      </div>
    </div>
  );
}

// ============================================================
// Strategy Library Tab
// ============================================================

function StrategyLibraryTab() {
  const [selected, setSelected] = useState<StrategyTemplate | null>(null);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Template list */}
      <div className="w-72 border-r border-border overflow-y-auto p-3 flex-shrink-0">
        <div className="mb-3 text-xs text-muted-foreground">
          Educational templates — no returns claimed. Backtest before use.
        </div>
        <div className="space-y-1.5">
          {STRATEGY_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selected?.id === t.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-border/80 hover:bg-panel/60"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] rounded border px-1.5 py-0.5 uppercase tracking-wide ${TEMPLATE_CATEGORY_COLORS[t.category]}`}>
                  {TEMPLATE_CATEGORY_LABELS[t.category]}
                </span>
              </div>
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Template detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <TemplateDetail template={selected} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground">Select a template to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateDetail({ template }: { template: StrategyTemplate }) {
  const createMutation = trpc.strategyDefinitions.create.useMutation();
  return (
    <div className="max-w-2xl">
      <div className="flex items-start gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] rounded border px-1.5 py-0.5 uppercase tracking-wide ${TEMPLATE_CATEGORY_COLORS[template.category]}`}>
              {TEMPLATE_CATEGORY_LABELS[template.category]}
            </span>
          </div>
          <h2 className="text-xl font-semibold">{template.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Hypothesis</div>
          <p className="text-sm">{template.hypothesis}</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-xs font-medium text-amber-400 uppercase tracking-wide mb-2">Known Limitations</div>
          <p className="text-sm text-muted-foreground">{template.limitations}</p>
        </div>
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Typical Timeframes</div>
          <div className="flex gap-2">
            {template.timeframes.map((tf) => (
              <span key={tf} className="rounded bg-background px-2 py-1 text-xs font-mono">{tf}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={createMutation.isPending}
          onClick={() => {
            createMutation.mutate(
              {
                name: template.name,
                description: template.description,
                definition: template.definition,
              },
              {
                onSuccess: (data: any) => {
                  if (data?.strategy?.id) {
                    window.location.href = `/_app/strategies/${data.strategy.id}`;
                  }
                },
              },
            );
          }}
        >
          <Plus className="h-4 w-4" />
          {createMutation.isPending ? "Creating..." : "Use This Template"}
        </button>
        <button
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <FlaskConical className="h-4 w-4" />
          Quick Backtest
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Educational Disclaimer:</strong> These templates are provided for research purposes only.
        Past strategy performance in backtests does not guarantee future results.
        This is a paper trading simulation — no real money is at risk.
      </div>
    </div>
  );
}

// ============================================================
// My Strategies Tab
// ============================================================

function MyStrategiesTab() {
  const { data, isLoading } = trpc.strategyDefinitions.list.useQuery();
  const strategies = data?.strategies ?? [];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-medium">My Strategies</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {strategies.length} {strategies.length === 1 ? "strategy" : "strategies"}
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          onClick={() => {}}
        >
          <Plus className="h-4 w-4" />
          New Strategy
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg border border-border bg-panel animate-pulse" />
          ))}
        </div>
      ) : strategies.length === 0 ? (
        <EmptyStrategies />
      ) : (
        <div className="space-y-2">
          {strategies.map((s: any) => (
            <StrategyCard key={s.id} strategy={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyCard({ strategy }: { strategy: any }) {
  const statusColors: Record<string, string> = {
    DRAFT: "text-muted-foreground border-border",
    VALIDATED: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
    ARCHIVED: "text-muted-foreground/50 border-border/50",
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4 hover:border-border/80">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{strategy.name}</span>
          <span className={`text-[10px] rounded border px-1.5 py-0.5 uppercase tracking-wide shrink-0 ${statusColors[strategy.status] ?? statusColors.DRAFT}`}>
            {strategy.status}
          </span>
        </div>
        {strategy.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{strategy.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/strategies/$strategyId"
          params={{ strategyId: strategy.id }}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Code2 className="h-3 w-3" />
          Edit
        </Link>
        <Link
          to="/strategies/$strategyId/backtests"
          params={{ strategyId: strategy.id }}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <FlaskConical className="h-3 w-3" />
          Backtests
        </Link>
      </div>
    </div>
  );
}

function EmptyStrategies() {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border">
      <Layers className="h-10 w-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm font-medium text-muted-foreground mb-1">No strategies yet</p>
      <p className="text-xs text-muted-foreground mb-4">Start from the library or create a blank strategy</p>
      <div className="flex gap-2">
        <button className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          Browse Library
        </button>
        <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
          <Plus className="h-3.5 w-3.5" />
          New Strategy
        </button>
      </div>
    </div>
  );
}

// ============================================================
// New Strategy Tab
// ============================================================

function NewStrategyTab() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-xl mx-auto">
        <h2 className="text-lg font-semibold mb-1">Create New Strategy</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Choose a starting point. You can customise all parameters in the visual rule builder.
        </p>

        <div className="space-y-3">
          {[
            {
              icon: BookOpen,
              title: "From Library Template",
              desc: "Start from one of the 7 educational templates",
              color: "text-blue-400",
              action: "Browse Library →",
            },
            {
              icon: Code2,
              title: "Blank Strategy",
              desc: "Start with an empty rule tree and build from scratch",
              color: "text-primary",
              action: "Start Blank →",
            },
            {
              icon: GitBranch,
              title: "Duplicate Existing",
              desc: "Copy one of your existing strategies and modify it",
              color: "text-purple-400",
              action: "My Strategies →",
            },
          ].map((opt) => (
            <button
              key={opt.title}
              className="w-full text-left flex items-start gap-4 rounded-lg border border-border bg-panel p-4 hover:border-primary/50 transition-colors"
            >
              <div className={`mt-0.5 ${opt.color}`}>
                <opt.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">{opt.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            </button>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-border bg-panel p-4 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground mb-2">Strategy Lab features</div>
          {[
            "Visual rule builder — no code required",
            "Backtest engine V3 with look-ahead protection",
            "Parameter sweep to explore strategy variants",
            "Walk-forward validation to test robustness",
            "ALERT_ONLY, MANUAL_CONFIRM, or AUTO_PAPER deployment",
            "Bar replay workspace for manual strategy testing",
          ].map((f) => (
            <div key={f} className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-primary shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}