import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  expiryProfile,
  netPremium,
  positionGreeks,
  templateLegs,
  type StrategyTemplate,
} from "@shared/domain/options/payoff";
import { ContractInputs } from "@/components/payoff/contract-inputs";
import { formatPrice } from "@/components/payoff/format";
import { LegsTable } from "@/components/payoff/legs-table";
import { PayoffChart } from "@/components/payoff/payoff-chart";
import { PayoffSummary } from "@/components/payoff/payoff-summary";
import { ScenarioGrid } from "@/components/payoff/scenario-grid";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  MAX_LEGS,
  draftFromSearch,
  loadStoredSearch,
  parsePayoffSearch,
  searchFromDraft,
  storeSearch,
  validateLab,
  withSymbol,
  type LabDraft,
  type LegDraft,
} from "@/lib/payoff-lab-state";

export const Route = createFileRoute("/_app/payoff")({
  validateSearch: parsePayoffSearch,
  head: () => ({ meta: [{ title: "Payoff Lab — MAET" }] }),
  component: PayoffLab,
});

let legSequence = 0;
const newLegId = () => `leg-${++legSequence}`;

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const DEFAULT_EXPIRY_DAYS = 7;
const MIN_VOLATILITY_PCT = 1;

function PayoffLab() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState<LabDraft>(() => draftFromSearch(search, newLegId));
  // The viewer's date is only known in the browser; null during the server render.
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    setToday(localIsoDate(now));
    // A shared link wins; an empty URL resumes the last session on this browser.
    const resumed = Object.keys(search).length === 0 ? loadStoredSearch(window.localStorage) : null;
    setDraft((current) => {
      const next = resumed ? draftFromSearch(resumed, newLegId) : current;
      if (next.contract.expiry !== "") return next;
      const expiry = new Date(now);
      expiry.setDate(now.getDate() + DEFAULT_EXPIRY_DAYS);
      return { ...next, contract: { ...next.contract, expiry: localIsoDate(expiry) } };
    });
    // Read the URL once on arrival; afterwards the draft drives the URL, not the reverse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (today === null) return;
    const next = searchFromDraft(draft);
    storeSearch(window.localStorage, next);
    void navigate({ search: next, replace: true });
  }, [draft, today, navigate]);

  const validation = useMemo(() => validateLab(draft, today), [draft, today]);
  const { lab } = validation;
  const shiftedVolatility = lab ? Math.max(lab.volatility * 100 + draft.ivShift, MIN_VOLATILITY_PCT) / 100 : 0;

  const analysis = useMemo(() => {
    if (!lab) return null;
    return {
      profile: expiryProfile(lab.legs, lab.lotSize),
      netPremium: netPremium(lab.legs, lab.lotSize),
      greeks: positionGreeks(
        lab.legs,
        {
          underlying: lab.spot,
          daysToExpiry: lab.daysToExpiry,
          daysForward: 0,
          rate: lab.rate,
          volatility: lab.volatility,
        },
        lab.lotSize,
      ),
    };
  }, [lab]);

  const spot = Number(draft.contract.spot);
  const strikeStep = Number(draft.contract.strikeStep);
  const templateBlocker =
    validation.contractErrors.spot !== undefined
      ? "Enter spot first"
      : validation.contractErrors.strikeStep !== undefined
        ? "Set the strike step first"
        : null;

  const setLegs = (update: (legs: LegDraft[]) => LegDraft[]) =>
    setDraft((current) => ({ ...current, legs: update(current.legs) }));

  const applyTemplate = (template: StrategyTemplate) => {
    if (templateBlocker) return;
    setLegs(() =>
      templateLegs(template, spot, strikeStep).map((leg) => ({
        id: newLegId(),
        side: leg.side,
        instrument: leg.instrument,
        strike: String(leg.strike),
        lots: "1",
        premium: "",
      })),
    );
  };

  const addLeg = () => {
    const atm = templateBlocker ? "" : String(Math.round(spot / strikeStep) * strikeStep);
    setLegs((legs) =>
      legs.length >= MAX_LEGS
        ? legs
        : [...legs, { id: newLegId(), side: "buy", instrument: "CE", strike: atm, lots: "1", premium: "" }],
    );
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 p-3 sm:p-4">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Payoff Lab</h1>
            {draft.contract.symbol && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                {draft.contract.symbol}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Prices are your inputs, not live quotes.</p>
        </header>

        <ContractInputs
          value={draft.contract}
          errors={validation.contractErrors}
          daysToExpiry={validation.daysToExpiry}
          onChange={(patch) => setDraft((current) => ({ ...current, contract: { ...current.contract, ...patch } }))}
          onSymbolChange={(symbol) => setDraft((current) => ({ ...current, contract: withSymbol(current.contract, symbol) }))}
        />

        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <LegsTable
              legs={draft.legs}
              errors={validation.legErrors}
              templateBlocker={templateBlocker}
              onChange={(id, patch) => setLegs((legs) => legs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)))}
              onRemove={(id) => setLegs((legs) => legs.filter((leg) => leg.id !== id))}
              onAdd={addLeg}
              onTemplate={applyTemplate}
            />
            {analysis && (
              <PayoffSummary profile={analysis.profile} netPremium={analysis.netPremium} greeks={analysis.greeks} />
            )}
          </div>

          <section aria-labelledby="payoff-chart-heading" className="min-w-0 rounded border border-border bg-panel">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
              <h2 id="payoff-chart-heading" className="font-semibold">
                Payoff
              </h2>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-px w-4 bg-foreground" /> At expiry
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t border-dashed border-primary" /> Today
                  {lab && <span className="font-mono">· IV {formatPrice(shiftedVolatility * 100, 1)}%</span>}
                </span>
              </div>
            </header>
            <div className="p-2">
              {lab && analysis ? (
                <PayoffChart
                  legs={lab.legs}
                  lotSize={lab.lotSize}
                  spot={lab.spot}
                  daysToExpiry={lab.daysToExpiry}
                  rate={lab.rate}
                  volatility={shiftedVolatility}
                  breakevens={analysis.profile.breakevens}
                  height={isMobile ? 260 : 380}
                />
              ) : (
                <p className="flex h-[260px] items-center justify-center px-6 text-center text-xs text-muted-foreground lg:h-[380px]">
                  {draft.legs.length === 0
                    ? "Add legs or pick a template to see the payoff."
                    : "Fill in the empty or highlighted inputs to see the payoff."}
                </p>
              )}
            </div>
          </section>
        </div>

        {lab && (
          <ScenarioGrid
            legs={lab.legs}
            lotSize={lab.lotSize}
            spot={lab.spot}
            daysToExpiry={lab.daysToExpiry}
            rate={lab.rate}
            baseVolatility={lab.volatility}
            volatility={shiftedVolatility}
            ivShift={draft.ivShift}
            onIvShiftChange={(ivShift) => setDraft((current) => ({ ...current, ivShift }))}
          />
        )}

        <footer className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          Black-Scholes on European-style assumptions with one IV for every strike; ignores early exercise,
          dividends, taxes and charges. Educational, not advice.
        </footer>
      </div>
    </div>
  );
}
