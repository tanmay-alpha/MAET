import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  combinationCount,
  defaultJobWindow,
  defaultRange,
  describeJobError,
  discoverSweepableParameters,
  expandRange,
  jobWindowToIso,
  MAX_SWEEP_COMBINATIONS,
  MAX_WALK_FORWARD_COMBINATIONS,
  type JobKind,
  type SweepParameterInput,
} from "@/lib/strategy-jobs";
import { DEFAULT_INITIAL_CAPITAL_INR } from "@shared/strategy/ast";

export interface StrategyVersionSummary {
  id: string;
  versionNumber: number;
  definition: unknown;
}

interface Props {
  kind: JobKind | null;
  onOpenChange: (open: boolean) => void;
  strategyId: string;
  /** Latest saved version: jobs run a saved version, never the unsaved draft. */
  version: StrategyVersionSummary | undefined;
  onCreated: (kind: JobKind, id: string) => void;
}

const TIMEFRAMES = ["1d", "1h", "15m", "5m", "1m", "1wk"];
const TITLES: Record<JobKind, { title: string; description: string }> = {
  backtest: { title: "Run backtest", description: "Simulate the strategy on stored candles." },
  sweep: { title: "Parameter sweep", description: "Backtest every combination of the parameter values below." },
  "walk-forward": {
    title: "Walk-forward test",
    description: "Pick parameters on past windows, validate them, then test them on the following unseen window.",
  },
};

interface RangeRow {
  path: string;
  name: string;
  currentValue: number;
  enabled: boolean;
  start: string;
  end: string;
  step: string;
}

/** Reads the definition fields the form defaults from; the definition is untyped JSON from the API. */
function definitionDefaults(definition: unknown) {
  const d = (definition ?? {}) as {
    timeframe?: unknown;
    universe?: { type?: unknown; symbolOrId?: unknown };
    execution?: { initialCapital?: unknown };
  };
  return {
    symbol: d.universe?.type === "SINGLE_SYMBOL" && typeof d.universe.symbolOrId === "string" ? d.universe.symbolOrId : "",
    timeframe: typeof d.timeframe === "string" && TIMEFRAMES.includes(d.timeframe) ? d.timeframe : "1d",
    capital: String(typeof d.execution?.initialCapital === "number" ? d.execution.initialCapital : DEFAULT_INITIAL_CAPITAL_INR),
  };
}

export function RunJobDialog({ kind, onOpenChange, strategyId, version, onCreated }: Props) {
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        {kind && (
          // Keyed so each opening starts from fresh defaults.
          <RunJobForm key={`${kind}-${version?.id ?? "none"}`} kind={kind} strategyId={strategyId} version={version} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RunJobForm({ kind, strategyId, version, onCreated }: Omit<Props, "kind" | "onOpenChange"> & { kind: JobKind }) {
  const defaults = definitionDefaults(version?.definition);
  const initialWindow = defaultJobWindow(new Date());
  const [symbol, setSymbol] = useState(defaults.symbol);
  const [timeframe, setTimeframe] = useState(defaults.timeframe);
  const [from, setFrom] = useState(initialWindow.from);
  const [to, setTo] = useState(initialWindow.to);
  const [capital, setCapital] = useState(defaults.capital);
  const [mode, setMode] = useState<"ROLLING" | "ANCHORED">("ROLLING");
  const [trainingDays, setTrainingDays] = useState("120");
  const [validationDays, setValidationDays] = useState("40");
  const [minimumWindows, setMinimumWindows] = useState("3");
  const [rows, setRows] = useState<RangeRow[]>(() =>
    discoverSweepableParameters(version?.definition).map((p, i) => {
      const range = defaultRange(p.currentValue);
      return { ...p, enabled: i < 2, start: String(range.start), end: String(range.end), step: String(range.step) };
    }),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const createBacktest = trpc.strategyBacktests.createJob.useMutation();
  const createSweep = trpc.strategyOptimisation.createSweep.useMutation();
  const createWalkForward = trpc.strategyOptimisation.createWalkForward.useMutation();
  const pending = createBacktest.isPending || createSweep.isPending || createWalkForward.isPending;
  const serverError = createBacktest.error ?? createSweep.error ?? createWalkForward.error;
  const errorInfo = serverError ? describeJobError(serverError) : null;

  const parameters = useMemo(() => {
    const out: SweepParameterInput[] = [];
    for (const row of rows.filter((r) => r.enabled)) {
      const values = expandRange(Number(row.start), Number(row.end), Number(row.step));
      if (!Array.isArray(values)) return { error: `${row.name}: ${values.error}` };
      out.push({ name: row.name, path: row.path, values });
    }
    return out;
  }, [rows]);
  const combos = Array.isArray(parameters) ? combinationCount(parameters) : 0;
  const comboLimit = kind === "sweep" ? MAX_SWEEP_COMBINATIONS : MAX_WALK_FORWARD_COMBINATIONS;

  const { title, description } = TITLES[kind];

  const submit = () => {
    setFormError(null);
    createBacktest.reset();
    createSweep.reset();
    createWalkForward.reset();
    if (!version) return setFormError("Create a version of this strategy first: jobs run a saved version.");
    const window = jobWindowToIso({ from, to });
    if ("error" in window) return setFormError(window.error);
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (!trimmedSymbol) return setFormError("Enter a symbol.");

    if (kind === "backtest") {
      const overrideCapital = Number(capital);
      if (!(overrideCapital > 0)) return setFormError("Initial capital must be a positive number.");
      createBacktest.mutate(
        { strategyVersionId: version.id, symbolOrUniverse: trimmedSymbol, timeframe, from: window.from, to: window.to, overrideCapital },
        { onSuccess: ({ job }) => onCreated("backtest", job.id) },
      );
      return;
    }

    if (!Array.isArray(parameters)) return setFormError(parameters.error);
    if (parameters.length === 0) return setFormError("Select at least one parameter to vary.");
    if (kind === "sweep") {
      if (combos > MAX_SWEEP_COMBINATIONS) return setFormError(`${combos} combinations; at most ${MAX_SWEEP_COMBINATIONS}.`);
      createSweep.mutate(
        { strategyId, parameters, symbolOrUniverse: trimmedSymbol, timeframe, from: window.from, to: window.to },
        { onSuccess: ({ sweep }) => onCreated("sweep", sweep.id) },
      );
      return;
    }

    const training = Number(trainingDays);
    const validation = Number(validationDays);
    const windows = Number(minimumWindows);
    if (!Number.isInteger(training) || training < 30) return setFormError("Training window must be at least 30 days.");
    if (!Number.isInteger(validation) || validation < 14) return setFormError("Test window must be at least 14 days.");
    if (!Number.isInteger(windows) || windows < 2 || windows > 20) return setFormError("Use between 2 and 20 windows.");
    createWalkForward.mutate(
      {
        strategyId,
        mode,
        parameters,
        symbol: trimmedSymbol,
        timeframe,
        from: window.from,
        to: window.to,
        trainingWindowDays: training,
        validationWindowDays: validation,
        minimumWindows: windows,
      },
      { onSuccess: ({ run }) => onCreated("walk-forward", run.id) },
    );
  };

  const updateRow = (path: string, patch: Partial<RangeRow>) =>
    setRows((current) => current.map((r) => (r.path === path ? { ...r, ...patch } : r)));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description} {version ? `Runs version v${version.versionNumber}.` : "This strategy has no saved version yet."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Symbol">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="RELIANCE" className={inputClass} />
          </Field>
          <Field label="Timeframe">
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className={inputClass}>
              {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </Field>
          <Field label="From">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          <Field label="To">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </Field>
          {kind === "backtest" && (
            <Field label="Initial capital (₹)">
              <input type="number" min={1} value={capital} onChange={(e) => setCapital(e.target.value)} className={inputClass} />
            </Field>
          )}
        </div>

        {kind === "walk-forward" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Mode">
              <select value={mode} onChange={(e) => setMode(e.target.value as "ROLLING" | "ANCHORED")} className={inputClass}>
                <option value="ROLLING">Rolling</option>
                <option value="ANCHORED">Anchored</option>
              </select>
            </Field>
            <Field label="Training days">
              <input type="number" min={30} value={trainingDays} onChange={(e) => setTrainingDays(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Test days">
              <input type="number" min={14} value={validationDays} onChange={(e) => setValidationDays(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Min. windows">
              <input type="number" min={2} max={20} value={minimumWindows} onChange={(e) => setMinimumWindows(e.target.value)} className={inputClass} />
            </Field>
          </div>
        )}

        {kind !== "backtest" && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Parameters to vary (start, end, step)</span>
              <span className={`text-xs font-mono ${combos > comboLimit ? "text-bear" : "text-muted-foreground"}`}>
                {combos} combination{combos === 1 ? "" : "s"}
                {kind === "walk-forward" && combos > comboLimit ? ` (only the first ${comboLimit} are optimised)` : ""}
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="rounded border border-border px-3 py-2 text-xs text-muted-foreground">
                The saved version has no numeric parameters to vary.
              </div>
            ) : (
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <div key={row.path} className="grid grid-cols-[1fr_4.5rem_4.5rem_4.5rem] items-center gap-2">
                    <label className="flex items-center gap-2 text-xs min-w-0" title={row.path}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => updateRow(row.path, { enabled: e.target.checked })} />
                      <span className="truncate">{row.name}</span>
                      <span className="text-muted-foreground font-mono">= {row.currentValue}</span>
                    </label>
                    {(["start", "end", "step"] as const).map((field) => (
                      <input
                        key={field}
                        aria-label={`${row.name} ${field}`}
                        type="number"
                        value={row[field]}
                        disabled={!row.enabled}
                        onChange={(e) => updateRow(row.path, { [field]: e.target.value })}
                        className={`${inputClass} disabled:opacity-40`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(formError || errorInfo) && (
          <div
            role="alert"
            className={`flex gap-2 rounded-md border px-3 py-2 text-xs ${
              errorInfo?.isJobLimit ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-bear/40 bg-bear/10 text-bear"
            }`}
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <div>
              {formError ?? (
                <>
                  <div className="font-medium">{errorInfo!.title}</div>
                  <div>{errorInfo!.message}</div>
                  {errorInfo!.isJobLimit && <div className="mt-1 opacity-80">Each kind of job allows 3 queued or running at once.</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <button
          onClick={submit}
          disabled={pending || !version}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {pending ? "Queueing..." : "Queue job"}
        </button>
      </DialogFooter>
    </>
  );
}

const inputClass = "w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
