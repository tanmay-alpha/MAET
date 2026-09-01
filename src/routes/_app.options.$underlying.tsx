import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Database } from "lucide-react";
import type { OptionChainContractView, PersistedOptionExpiryView } from "../../server/modules/options/contracts";
import { GreekDisplay } from "@/components/options/greek-display";
import { trpc } from "@/lib/trpc";

const UNAVAILABLE = "—";

export const Route = createFileRoute("/_app/options/$underlying")({
  head: () => ({ meta: [{ title: "Options Chain — MAET" }] }),
  component: OptionsChain,
});

type OptionPair = {
  strikePrice: string;
  call: OptionChainContractView | null;
  put: OptionChainContractView | null;
};

function choosePersistedExpiry(expiries: PersistedOptionExpiryView[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  return expiries.find((expiry) => expiry.expiryDate >= today)?.expiryDate
    ?? expiries.at(-1)?.expiryDate
    ?? null;
}

function formatDecimal(value: string | null, digits = 2): string {
  if (value === null) return UNAVAILABLE;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : value;
}

function formatQuantity(value: number | null): string {
  return value === null ? UNAVAILABLE : value.toLocaleString("en-IN");
}

function formatTimestamp(timestamp: string | null): string {
  if (timestamp === null) return UNAVAILABLE;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatRange(oldest: string | null, newest: string | null): string {
  if (oldest === null || newest === null) return UNAVAILABLE;
  const earliest = formatTimestamp(oldest);
  const latest = formatTimestamp(newest);
  return earliest === latest ? earliest : `${earliest}–${latest}`;
}

function pairContracts(contracts: OptionChainContractView[]): OptionPair[] {
  const pairs = new Map<string, OptionPair>();
  for (const contract of contracts) {
    const pair = pairs.get(contract.strikePrice) ?? {
      strikePrice: contract.strikePrice,
      call: null,
      put: null,
    };
    if (contract.optionType === "CE") pair.call = contract;
    else pair.put = contract;
    pairs.set(contract.strikePrice, pair);
  }
  return [...pairs.values()];
}

function OptionSide({ contract, reverse = false }: { contract: OptionChainContractView | null; reverse?: boolean }) {
  const quote = contract?.quote ?? null;
  const cells = [
    <td key="ltp" className="px-3 py-2 text-right font-mono tabular">{formatDecimal(quote?.ltp ?? null)}</td>,
    <td key="oi" className="px-3 py-2 text-right font-mono tabular">{formatQuantity(quote?.openInterest ?? null)}</td>,
    <td key="volume" className="px-3 py-2 text-right font-mono tabular">{formatQuantity(quote?.volume ?? null)}</td>,
    <td key="iv" className="px-3 py-2 text-right font-mono tabular">{formatDecimal(contract?.greeks?.impliedVolatility ?? null, 4)}</td>,
    <td key="greeks" className="min-w-28 px-3 py-2 align-top"><GreekDisplay greeks={contract?.greeks ?? null} compact /></td>,
  ];
  return <>{reverse ? cells.reverse() : cells}</>;
}

function OptionsChain() {
  const { underlying } = Route.useParams();
  const symbol = underlying.trim().toUpperCase();
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const expiriesQuery = trpc.options.listExpiries.useQuery({ underlying: symbol });
  const expiries = expiriesQuery.data ?? [];
  const selectedExpiryIsPersisted = selectedExpiry !== null
    && expiries.some((expiry) => expiry.expiryDate === selectedExpiry);

  useEffect(() => {
    if (selectedExpiryIsPersisted) return;
    setSelectedExpiry(choosePersistedExpiry(expiries));
  }, [expiries, selectedExpiryIsPersisted]);

  const chainInput = selectedExpiry === null ? undefined : { underlying: symbol, expiryDate: selectedExpiry };
  const chainQuery = trpc.options.getLatestChain.useQuery(chainInput, {
    enabled: chainInput !== undefined,
  });
  const pairs = useMemo(() => pairContracts(chainQuery.data?.contracts ?? []), [chainQuery.data?.contracts]);
  const chain = chainQuery.data;
  const isPartial = chain !== undefined
    && (chain.coverage.quotes < chain.coverage.contracts || chain.coverage.greeks < chain.coverage.contracts);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <Link
          to="/screener"
          className="rounded border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to screener"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-48">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Options Chain</h1>
            <span className="rounded bg-accent px-2 py-0.5 font-mono text-xs text-muted-foreground">{symbol}</span>
          </div>
          <p className="text-sm text-muted-foreground">Angel One / NFO persisted market observations</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Expiry
          <select
            aria-label="Persisted expiry"
            value={selectedExpiry ?? ""}
            onChange={(event) => setSelectedExpiry(event.target.value || null)}
            disabled={expiriesQuery.isLoading || expiries.length === 0}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
          >
            {selectedExpiry === null && <option value="">No persisted expiry</option>}
            {expiries.map((expiry) => (
              <option key={expiry.expiryDate} value={expiry.expiryDate}>{expiry.expiryDate}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
        {expiriesQuery.isLoading && (
          <div className="rounded border border-border bg-panel p-4 text-sm text-muted-foreground">Loading persisted option expiries…</div>
        )}
        {expiriesQuery.isError && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Unable to load persisted expiries: {expiriesQuery.error.message}
          </div>
        )}
        {!expiriesQuery.isLoading && !expiriesQuery.isError && expiries.length === 0 && (
          <section className="flex max-w-2xl items-start gap-3 rounded-lg border border-border bg-panel p-5">
            <Database className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h2 className="font-medium">No persisted option expiries</h2>
              <p className="mt-1 text-sm text-muted-foreground">No Angel One / NFO contracts have been stored for {symbol} yet.</p>
            </div>
          </section>
        )}
        {selectedExpiry !== null && chainQuery.isLoading && (
          <div className="rounded border border-border bg-panel p-4 text-sm text-muted-foreground">Loading persisted option chain…</div>
        )}
        {chainQuery.isError && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Unable to load the persisted chain: {chainQuery.error.message}
          </div>
        )}
        {chain !== undefined && (
          <>
            <section className="flex flex-wrap gap-x-5 gap-y-2 rounded border border-border bg-panel px-4 py-3 text-xs">
              <span><span className="text-muted-foreground">Source:</span> Angel One / NFO</span>
              <span><span className="text-muted-foreground">Quotes:</span> {chain.coverage.quotes} / {chain.coverage.contracts}</span>
              <span><span className="text-muted-foreground">Greeks:</span> {chain.coverage.greeks} / {chain.coverage.contracts}</span>
              <span><span className="text-muted-foreground">Quote feed:</span> {formatRange(chain.freshness.oldestQuoteAt, chain.freshness.newestQuoteAt)}</span>
              <span><span className="text-muted-foreground">Greeks observed:</span> {formatRange(chain.freshness.oldestGreekObservedAt, chain.freshness.newestGreekObservedAt)}</span>
            </section>
            {chain.contracts.length > 0 && chain.coverage.quotes === 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">Contracts are persisted, but no quote observations are available yet.</div>
            )}
            {isPartial && chain.coverage.quotes > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">Partial persisted coverage is shown; unavailable observations remain marked {UNAVAILABLE}.</div>
            )}
            {chain.contracts.length === 0 ? (
              <div className="rounded border border-border bg-panel p-4 text-sm text-muted-foreground">This persisted expiry has no canonical option contracts.</div>
            ) : (
              <div className="overflow-x-auto rounded border border-border bg-panel">
                <table className="w-full min-w-[1100px] border-collapse text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr className="border-b border-border">
                      <th colSpan={5} className="px-3 py-2 text-right font-medium">CALLS</th>
                      <th className="border-x border-border px-3 py-2 text-center font-medium">STRIKE</th>
                      <th colSpan={5} className="px-3 py-2 text-left font-medium">PUTS</th>
                    </tr>
                    <tr className="border-b border-border font-medium">
                      <th className="px-3 py-2 text-right">LTP</th>
                      <th className="px-3 py-2 text-right">OI</th>
                      <th className="px-3 py-2 text-right">Volume</th>
                      <th className="px-3 py-2 text-right">IV</th>
                      <th className="px-3 py-2 text-left">Greeks</th>
                      <th className="border-x border-border px-3 py-2 text-center">Strike</th>
                      <th className="px-3 py-2 text-right">Greeks</th>
                      <th className="px-3 py-2 text-right">IV</th>
                      <th className="px-3 py-2 text-right">Volume</th>
                      <th className="px-3 py-2 text-right">OI</th>
                      <th className="px-3 py-2 text-right">LTP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((pair) => (
                      <tr key={pair.strikePrice} className="border-b border-border/70 last:border-0 hover:bg-accent/30">
                        <OptionSide contract={pair.call} />
                        <td className="border-x border-border px-3 py-2 text-center font-mono tabular font-semibold">{formatDecimal(pair.strikePrice, 2)}</td>
                        <OptionSide contract={pair.put} reverse />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
