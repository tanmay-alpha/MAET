import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { rupees } from "@/components/investing/display";
import { usePaperLedger } from "@/hooks/use-paper-ledger";
import {
  ledgerEntryLabel,
  ledgerTotals,
  reconcileAccount,
  withRunningBalances,
  type PaperLedgerEntry,
} from "@/lib/paper-ledger";
import type { PaperAccountRow } from "../../../server/modules/paper-trading/contracts";

const TH = "px-3 py-2 font-medium";

const signed = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));

function istTimestamp(value: string): string {
  return `${new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })} IST`;
}

/** What produced an entry, from the fields the engine records in its metadata. */
function entryDetail(entry: PaperLedgerEntry): string {
  const meta = typeof entry.metadata === "object" && entry.metadata !== null ? entry.metadata : {};
  const side = Reflect.get(meta, "side");
  const qty = Reflect.get(meta, "qty");
  const price = Reflect.get(meta, "fillPrice");
  const source = entry.sourceType === "LIQUIDATION_FILL" ? "Margin liquidation fill" : entry.sourceType === "FILL" ? "Fill" : null;
  if (entry.entryType === "TRADE_REALIZED_PNL" && typeof side === "string" && typeof qty === "number" && typeof price === "number") {
    return `${source ?? "Fill"}: ${side} ${qty} @ ${rupees(price)}`;
  }
  if (entry.entryType === "EXECUTION_FEE") return `${source ?? "Fill"} charges`;
  if (entry.entryType === "INITIAL_CASH") return `Account funded (generation ${entry.generation})`;
  return source ?? entry.sourceType;
}

function Line({ label, value, note, strong = false }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "border-t border-border font-semibold" : ""}`}>
      <dt className="text-muted-foreground">
        {label}
        {note ? <span className="block text-[10px] font-normal">{note}</span> : null}
      </dt>
      <dd className="shrink-0 font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The paper account's cash ledger (every movement of cash, with the balance after it) and
 * a reconciliation of the account row against it: opening cash + realised P&L − charges =
 * cash, and cash + unrealised P&L = equity. Positions are margin-funded, so their market
 * value is exposure, not part of cash or equity.
 */
export function CashLedgerSection({
  account,
  unrealizedPnl,
  positionsMarketValue,
}: {
  account: PaperAccountRow;
  unrealizedPnl: number;
  positionsMarketValue: number;
}) {
  const ledger = usePaperLedger(true);
  const entries = useMemo(() => ledger.data?.pages.flatMap((page) => page.entries) ?? [], [ledger.data]);
  const rows = useMemo(() => withRunningBalances(entries), [entries]);
  const complete = ledger.isSuccess && !ledger.hasNextPage;
  const reconciliation = reconcileAccount({
    account,
    ledger: complete ? ledgerTotals(entries) : null,
    unrealizedPnl,
    positionsMarketValue,
  });
  const currencies = [...new Set(entries.map((entry) => entry.currency))];
  const unit = currencies.length === 0 || (currencies.length === 1 && currencies[0] === "INR") ? "INR (₹)" : currencies.join(", ");

  return (
    <section aria-labelledby="cash-ledger-heading" className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div role="region" aria-label="Cash and equity reconciliation" className="rounded-lg border border-border bg-panel p-4 text-xs">
        <h2 className="text-sm font-semibold">Cash &amp; equity reconciliation</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">All amounts in INR (₹). Positions are margin-funded: buying does not debit cash.</p>
        <dl className="mt-3">
          <Line label="Opening cash" value={rupees(reconciliation.openingCash)} />
          <Line label="+ Realised P&L" note="closed trades, before charges" value={signed(reconciliation.realizedPnl)} />
          <Line
            label="− Charges"
            note="from the ledger"
            value={reconciliation.charges === null ? "—" : rupees(reconciliation.charges)}
          />
          <Line label="= Cash balance" value={rupees(reconciliation.cash)} strong />
          <Line label="+ Unrealised P&L" note="open positions at current quotes" value={signed(reconciliation.unrealizedPnl)} />
          <Line label="= Equity" value={rupees(reconciliation.equity)} strong />
          <Line label="Net P&L after charges" note="equity − opening cash" value={signed(reconciliation.netPnl)} />
          <Line label="Positions market value" note="gross exposure, not added to cash" value={rupees(reconciliation.positionsMarketValue)} />
        </dl>
        <div role="status" className="mt-3 rounded border border-border/70 px-2.5 py-2 text-[11px]">
          {ledger.isError ? (
            <span className="text-amber-400">Ledger unavailable: {ledger.error.message}</span>
          ) : ledger.isPending ? (
            <span className="text-muted-foreground">Loading the ledger to verify cash…</span>
          ) : reconciliation.reconciled === null ? (
            <span className="text-muted-foreground">Load the older ledger entries to verify cash against the full ledger.</span>
          ) : reconciliation.reconciled ? (
            <span className="flex items-center gap-1.5 text-bull">
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
              {entries.length === 1
                ? "Ledger reconciles: its 1 entry equals the cash balance."
                : `Ledger reconciles: its ${entries.length} entries sum to the cash balance.`}
            </span>
          ) : (
            <span className="flex items-start gap-1.5 text-amber-400">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Ledger does not reconcile: cash differs by {signed(reconciliation.ledgerCashDifference ?? 0)}, realised P&amp;L by{" "}
                {signed(reconciliation.realizedPnlDifference ?? 0)}.
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cash-ledger-heading" className="text-lg font-semibold">Cash ledger</h2>
          <span className="text-xs text-muted-foreground">Amounts in {unit} · newest first · balance after each entry</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-panel">
          <table aria-label="Cash ledger entries" className="w-full min-w-[40rem] text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className={TH}>Time</th>
                <th className={TH}>Type</th>
                <th className={TH}>Details</th>
                <th className={`${TH} text-right`}>Amount (₹)</th>
                <th className={`${TH} text-right`}>Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, amount, runningBalance }) => (
                <tr key={entry.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{istTimestamp(entry.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{ledgerEntryLabel(entry.entryType)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{entryDetail(entry)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono ${amount > 0 ? "text-bull" : amount < 0 ? "text-bear" : ""}`}>
                    {signed(amount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{rupees(runningBalance)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {ledger.isPending ? "Loading ledger…" : ledger.isError ? "The ledger could not be loaded." : "No ledger entries yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {ledger.hasNextPage ? (
          <button
            type="button"
            onClick={() => void ledger.fetchNextPage()}
            disabled={ledger.isFetchingNextPage}
            className="mt-2 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {ledger.isFetchingNextPage ? "Loading…" : "Load older entries"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
