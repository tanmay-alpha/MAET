import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { STRATEGY_TEMPLATES, templateCreateInput, TEMPLATE_CATEGORY_LABELS, type StrategyTemplate } from "@/components/strategy/strategy-library";
import { EmptyLine, ErrorLine, PageHeader, primaryButton, secondaryButton, ViewSwitch } from "@/components/strategy/page-chrome";
import { executionRows, groupText, riskRows } from "@/components/strategy/rule-text";
import { shortDate } from "@/components/strategy/format";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/strategies/")({
  head: () => ({ meta: [{ title: "Strategy Lab — MAET" }] }),
  component: StrategyLab,
});

type LabView = "library" | "mine";

const VIEWS = [
  { id: "library", label: "Library" },
  { id: "mine", label: "My strategies" },
] as const;

function StrategyLab() {
  const [view, setView] = useState<LabView>("library");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Strategy Lab"
        meta={`${STRATEGY_TEMPLATES.length} rule templates · backtests run on stored candles · paper only`}
        actions={<ViewSwitch label="Strategy Lab view" options={VIEWS} value={view} onChange={setView} />}
      />
      <div className="min-h-0 flex-1">
        {view === "library" ? <Library /> : <MyStrategies onBrowse={() => setView("library")} />}
      </div>
    </div>
  );
}

// ============================================================
// Library
// ============================================================

function Library() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = STRATEGY_TEMPLATES.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <ul
        aria-label="Strategy templates"
        className={`${selected ? "hidden md:block" : ""} min-h-0 flex-1 overflow-y-auto border-border md:w-80 md:flex-none md:border-r`}
      >
        {STRATEGY_TEMPLATES.map((t) => (
          <li key={t.id} className="border-b border-border">
            <button
              type="button"
              aria-current={selected?.id === t.id}
              onClick={() => setSelectedId(t.id)}
              className="w-full px-4 py-2.5 text-left hover:bg-accent/40 aria-[current=true]:bg-accent"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{t.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{TEMPLATE_CATEGORY_LABELS[t.category]}</span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{groupText(t.definition.entry)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className={`${selected ? "" : "hidden md:block"} min-h-0 flex-1 overflow-y-auto p-4`}>
        {selected ? (
          <TemplateDetail template={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <p className="text-xs text-muted-foreground">Select a template to see its rules, the idea behind it and where it fails.</p>
        )}
      </div>
    </div>
  );
}

function TemplateDetail({ template, onBack }: { template: StrategyTemplate; onBack: () => void }) {
  const signedIn = useSignedIn();
  const createMutation = trpc.strategyDefinitions.create.useMutation();
  const navigate = useNavigate();
  const input = templateCreateInput(template);
  const { definition } = input;
  const startsWith = [
    ["Symbol", definition.universe?.symbolOrId ?? "—"],
    ["Timeframe", definition.timeframe ?? "—"],
    ...riskRows(definition.risk).slice(0, 1),
    ...executionRows(definition.execution),
  ];

  return (
    <article className="max-w-3xl space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground md:hidden">
        ← All templates
      </button>

      <header>
        <p className="text-xs text-muted-foreground">
          {TEMPLATE_CATEGORY_LABELS[template.category]} · suits {template.timeframes.join(", ")}
        </p>
        <h2 className="text-lg font-semibold">{template.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
      </header>

      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 rounded border border-border bg-panel px-3 py-2.5 text-xs">
        <dt className="text-muted-foreground">Entry</dt>
        <dd className="font-mono">{groupText(definition.entry)}</dd>
        <dt className="text-muted-foreground">Exit</dt>
        <dd className="font-mono">{groupText(definition.exit)}</dd>
        <dt className="text-muted-foreground">Direction</dt>
        <dd>{definition.direction === "LONG_ONLY" ? "Long only" : definition.direction === "SHORT_ONLY" ? "Short only" : "Long and short"}</dd>
      </dl>

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">Idea</h3>
        <p className="mt-1 text-sm">{template.hypothesis}</p>
      </section>
      <section>
        <h3 className="text-xs font-medium text-muted-foreground">Where it fails</h3>
        <p className="mt-1 text-sm">{template.limitations}</p>
      </section>

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">Saved with</h3>
        <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {startsWith.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-border py-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="space-y-2">
        <button
          type="button"
          className={primaryButton}
          disabled={!signedIn || createMutation.isPending}
          onClick={() =>
            createMutation.mutate(input, {
              onSuccess: (data) => void navigate({ to: "/strategies/$strategyId", params: { strategyId: data.strategy.id } }),
            })
          }
        >
          {createMutation.isPending ? "Saving…" : "Use this template"}
        </button>
        {!signedIn && <SignedOutNotice feature="Saved strategies" />}
        {createMutation.error && <ErrorLine title="Could not save the strategy" error={createMutation.error} />}
      </div>
    </article>
  );
}

// ============================================================
// My strategies
// ============================================================

interface StrategyRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
}

const STATUS_TONE: Record<string, string> = {
  VALIDATED: "text-bull",
  ARCHIVED: "text-muted-foreground/60",
};

function MyStrategies({ onBrowse }: { onBrowse: () => void }) {
  const signedIn = useSignedIn();
  const { data, isLoading, error } = trpc.strategyDefinitions.list.useQuery(undefined, { enabled: signedIn });
  const strategies: StrategyRow[] = data?.strategies ?? [];

  if (!signedIn) return <div className="p-4"><SignedOutNotice feature="Saved strategies" /></div>;
  if (error) return <div className="p-4"><ErrorLine title="Could not load your strategies" error={error} /></div>;
  if (isLoading) return <EmptyLine>Loading strategies…</EmptyLine>;
  if (strategies.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 p-4 text-xs text-muted-foreground">
        No saved strategies yet. Save one from a library template.
        <button type="button" onClick={onBrowse} className={secondaryButton}>Open library</button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 border-b border-border bg-panel text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Strategy</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Updated</th>
            <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {strategies.map((s) => (
            <tr key={s.id} className="hover:bg-accent/30">
              <td className="max-w-0 px-4 py-2">
                <Link to="/strategies/$strategyId" params={{ strategyId: s.id }} className="font-medium hover:text-primary">
                  {s.name}
                </Link>
                {s.description && <div className="truncate text-muted-foreground">{s.description}</div>}
              </td>
              <td className={`px-3 py-2 ${STATUS_TONE[s.status] ?? "text-muted-foreground"}`}>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground sm:table-cell">{shortDate(s.updatedAt)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right">
                <Link to="/strategies/$strategyId/backtests" params={{ strategyId: s.id }} className="text-muted-foreground hover:text-foreground">
                  Research
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
