import { Plus, X } from "lucide-react";
import { STRATEGY_TEMPLATES, type Instrument, type StrategyTemplate } from "@shared/domain/options/payoff";
import { MAX_LEGS, type LegDraft, type LegErrors } from "@/lib/payoff-lab-state";
import { cn } from "@/lib/utils";
import { INPUT_CLASS, decimalDraft } from "./field";

interface LegsTableProps {
  legs: LegDraft[];
  errors: Record<string, LegErrors>;
  /** Why templates are unavailable, or null when they can be applied. */
  templateBlocker: string | null;
  onChange: (id: string, patch: Partial<LegDraft>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onTemplate: (template: StrategyTemplate) => void;
}

const INSTRUMENTS: Instrument[] = ["CE", "PE", "FUT"];

export function LegsTable({ legs, errors, templateBlocker, onChange, onRemove, onAdd, onTemplate }: LegsTableProps) {
  return (
    <section aria-labelledby="payoff-legs-heading" className="flex min-w-0 flex-col rounded border border-border bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 id="payoff-legs-heading" className="text-xs font-semibold">
          Legs <span className="font-mono font-normal text-muted-foreground">{legs.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            aria-label="Strategy template"
            className={cn(INPUT_CLASS, "w-auto font-sans")}
            value=""
            disabled={templateBlocker !== null}
            title={templateBlocker ?? "Replaces the legs; premiums stay blank for you to enter"}
            onChange={(event) => event.target.value && onTemplate(event.target.value as StrategyTemplate)}
          >
            <option value="">Template…</option>
            {STRATEGY_TEMPLATES.map((template) => (
              <option key={template} value={template}>
                {template}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAdd}
            disabled={legs.length >= MAX_LEGS}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add leg
          </button>
        </div>
        {templateBlocker && <p className="w-full text-[10px] text-muted-foreground">Templates: {templateBlocker.toLowerCase()}.</p>}
      </header>

      {legs.length === 0 ? (
        <p className="px-3 py-6 text-xs text-muted-foreground">No legs yet. Pick a template or add a leg.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] border-collapse text-xs">
            <thead className="text-tv-caps text-muted-foreground">
              <tr>
                <th className="py-1.5 pl-2 pr-0.5 text-left font-medium sm:pl-3 sm:pr-1">Side</th>
                <th className="px-0.5 py-1.5 text-left font-medium sm:px-1">Type</th>
                <th className="px-0.5 py-1.5 text-left font-medium sm:px-1">Strike</th>
                <th className="px-0.5 py-1.5 text-left font-medium sm:px-1">Lots</th>
                <th className="px-0.5 py-1.5 text-left font-medium sm:px-1">Premium</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, index) => {
                const legErrors = errors[leg.id] ?? {};
                const label = `Leg ${index + 1}`;
                return (
                  <tr key={leg.id} className="border-t border-border/70 align-top hover:bg-accent/30">
                    <td className="py-1.5 pl-2 pr-0.5 sm:pl-3 sm:pr-1">
                      <div role="group" aria-label={`${label} side`} className="flex h-7 overflow-hidden rounded border border-border">
                        {(["buy", "sell"] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            aria-pressed={leg.side === side}
                            aria-label={side === "buy" ? "Buy" : "Sell"}
                            title={side === "buy" ? "Buy" : "Sell"}
                            onClick={() => onChange(leg.id, { side })}
                            className={`w-7 text-[11px] font-semibold sm:w-9 ${
                              leg.side === side
                                ? side === "buy"
                                  ? "bg-bull text-white"
                                  : "bg-bear text-white"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {side === "buy" ? "B" : "S"}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-0.5 py-1.5 sm:px-1">
                      <select
                        aria-label={`${label} type`}
                        className={cn(INPUT_CLASS, "w-[54px] px-1 sm:w-[64px] sm:px-1.5")}
                        value={leg.instrument}
                        onChange={(event) => onChange(leg.id, { instrument: event.target.value as Instrument })}
                      >
                        {INSTRUMENTS.map((instrument) => (
                          <option key={instrument}>{instrument}</option>
                        ))}
                      </select>
                    </td>
                    <DraftCell
                      label={`${label} ${leg.instrument === "FUT" ? "entry price" : "strike"}`}
                      value={leg.strike}
                      error={legErrors.strike}
                      onChange={(strike) => onChange(leg.id, { strike })}
                    />
                    <DraftCell
                      label={`${label} lots`}
                      value={leg.lots}
                      error={legErrors.lots}
                      width="w-11 sm:w-14"
                      onChange={(lots) => onChange(leg.id, { lots })}
                    />
                    {leg.instrument === "FUT" ? (
                      <td className="px-0.5 py-1.5 sm:px-1">
                        <div className={`${INPUT_CLASS} flex items-center text-muted-foreground`} title="Futures carry no premium">
                          —
                        </div>
                      </td>
                    ) : (
                      <DraftCell
                        label={`${label} premium`}
                        value={leg.premium}
                        error={legErrors.premium}
                        placeholder="₹ / unit"
                        onChange={(premium) => onChange(leg.id, { premium })}
                      />
                    )}
                    <td className="py-1.5 pr-2">
                      <button
                        type="button"
                        aria-label={`Remove ${label.toLowerCase()}`}
                        onClick={() => onRemove(leg.id)}
                        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-bear"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DraftCell({
  label,
  value,
  error,
  width = "",
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  width?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <td className={`px-0.5 py-1.5 sm:px-1 ${width}`}>
      <input
        aria-label={label}
        className={cn(INPUT_CLASS, "px-1.5")}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        onChange={(event) => onChange(decimalDraft(event.target.value))}
      />
      {error && <div className="mt-0.5 text-[10px] leading-none text-bear">{error}</div>}
    </td>
  );
}
