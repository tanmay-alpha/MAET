import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { cashFlowReturn, type ImportAnalysis } from "@shared/domain/investing/import/analyse";
import { toCsv } from "@shared/domain/investing/import/csv";
import { financialYearLabel } from "@shared/domain/investing/import/dates";
import { CapitalGainsBuckets, CapitalGainsFigures, Figure } from "@/components/investing/capital-gains-summary";
import { percent, rupees } from "@/components/investing/display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadCsv } from "@/lib/import/read-csv-file";
import { fetchMarketQuotes } from "@/lib/market-api";

/** /api/market/quotes accepts at most this many symbols per request. */
const QUOTE_BATCH = 50;

const signed = (value: number) => <span className={value > 0 ? "text-bull" : value < 0 ? "text-bear" : ""}>{rupees(value)}</span>;
/** Export figures stay `number`s, so toCsv writes them as numbers and only text cells get formula-neutralised. */
const fixed = (value: number) => Number(value.toFixed(2));

function ExportButton({ fileName, rows }: { fileName: string; rows: Array<Array<string | number>> }) {
  return <button type="button" onClick={() => downloadCsv(fileName, toCsv(rows))}
    className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent">
    <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
  </button>;
}

const SOURCE_NAMES: Record<string, string> = { angelone: "Angel One", yahoo: "Yahoo" };

interface QuoteFill {
  filled: number;
  missing: string[];
  source: string;
  asOf: string;
}

const istTime = (timestamp: string) => new Date(timestamp).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

export function ResultsStep({ analysis, onBack }: { analysis: ImportAnalysis; onBack: () => void }) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [quoteFill, setQuoteFill] = useState<QuoteFill>();
  const [quoteError, setQuoteError] = useState<string>();
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [financialYear, setFinancialYear] = useState(analysis.financialYears[0]);
  const asOf = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const cash = useMemo(() => cashFlowReturn(analysis, prices, asOf), [analysis, prices, asOf]);
  const tax = useMemo(() => (financialYear === undefined ? undefined : analysis.taxReport(financialYear)), [analysis, financialYear]);
  const trips = analysis.trips.filter((trip) => trip.financialYearStart === financialYear);
  const realisedTotal = trips.reduce((total, trip) => total + trip.gain, 0);

  function setPrice(symbol: string, text: string) {
    setPriceText((current) => ({ ...current, [symbol]: text }));
    const value = Number(text);
    setPrices((current) => {
      const next = { ...current };
      if (text.trim() !== "" && value > 0) next[symbol] = value;
      else delete next[symbol];
      return next;
    });
  }

  async function fillFromQuotes() {
    setLoadingQuotes(true);
    setQuoteError(undefined);
    try {
      const symbols = analysis.holdings.map((holding) => holding.symbol);
      const batches: string[][] = [];
      for (let index = 0; index < symbols.length; index += QUOTE_BATCH) batches.push(symbols.slice(index, index + QUOTE_BATCH));
      const responses = await Promise.all(batches.map((batch) => fetchMarketQuotes(batch)));
      const quoted = new Map(responses.flatMap((response) => response.quotes.map((quote) => [quote.symbol, quote.price] as const)));
      for (const [symbol, price] of quoted) if (symbols.includes(symbol)) setPrice(symbol, String(price));
      const oldest = responses.map((response) => response.asOf).sort()[0]!;
      setQuoteFill({
        filled: symbols.filter((symbol) => quoted.has(symbol)).length,
        missing: symbols.filter((symbol) => !quoted.has(symbol)),
        source: [...new Set(responses.map((response) => SOURCE_NAMES[response.source] ?? response.source))].join(", "),
        asOf: oldest,
      });
    } catch (caught) {
      setQuoteError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingQuotes(false);
    }
  }

  const holdingsValue = analysis.holdings.reduce((total, holding) => total + holding.quantity * (prices[holding.symbol] ?? 0), 0);

  return <section aria-labelledby="results-step-heading" className="border border-border bg-panel p-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="results-step-heading" className="text-sm font-semibold">Results</h2>
      <button type="button" onClick={onBack} className="rounded border border-border px-3 py-1.5 hover:bg-accent">Back to rows</button>
    </div>
    <p className="mt-1 text-muted-foreground">FIFO per symbol across NSE and BSE, gross of brokerage and charges. {analysis.trades.length} accepted trades.</p>

    <Tabs defaultValue="holdings" className="mt-3">
      <TabsList className="h-8 rounded border border-border bg-background p-0.5">
        <TabsTrigger value="holdings" className="rounded px-3 text-xs">Holdings · {analysis.holdings.length}</TabsTrigger>
        <TabsTrigger value="realised" className="rounded px-3 text-xs">Realised · {analysis.trips.length}</TabsTrigger>
        <TabsTrigger value="cash" className="rounded px-3 text-xs">Cash flows</TabsTrigger>
      </TabsList>

      <TabsContent value="holdings" className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void fillFromQuotes()} disabled={loadingQuotes || analysis.holdings.length === 0}
            className="rounded border border-primary px-3 py-1 font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
            {loadingQuotes ? "Fetching quotes…" : "Fill from MAET quotes"}
          </button>
          <span className="text-muted-foreground">Sends only the {analysis.holdings.length} symbol names to MAET's quote service; the file stays in this tab.</span>
          <span className="ml-auto"><ExportButton fileName="holdings.csv" rows={[
            ["symbol", "quantity", "avg_cost", "invested", "oldest_lot", "ltcg_eligible_from", "all_lots_ltcg_from", "current_price", "unrealised"],
            ...analysis.holdings.map((holding) => {
              const price = prices[holding.symbol];
              return [holding.symbol, holding.quantity, fixed(holding.avgCost), fixed(holding.invested), holding.oldestLotDate, holding.ltcgEligibleFrom,
                holding.fullyLtcgEligibleFrom, price === undefined ? "" : fixed(price), price === undefined ? "" : fixed(holding.quantity * price - holding.invested)];
            }),
          ]} /></span>
        </div>
        {quoteFill && <p role="status" className="mt-2 text-muted-foreground">
          Filled {quoteFill.filled} of {analysis.holdings.length} from {quoteFill.source} quotes as of {istTime(quoteFill.asOf)} IST
          {quoteFill.missing.length > 0 && `; no quote for ${quoteFill.missing.join(", ")}`}. Edit any price to override.
        </p>}
        {quoteError && <p role="alert" className="mt-2 text-bear">Quotes unavailable: {quoteError}. Type prices instead.</p>}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left">
            <thead><tr className="border-b border-border">
              <th className="py-1 pr-3">Symbol</th><th className="pr-3 text-right">Qty</th><th className="pr-3 text-right">Avg cost</th><th className="pr-3 text-right">Invested</th>
              <th className="pr-3">LTCG from</th><th className="pr-3">Current price</th><th className="text-right">Unrealised</th>
            </tr></thead>
            <tbody>{analysis.holdings.map((holding) => {
              const price = prices[holding.symbol];
              return <tr key={holding.symbol} className="border-b border-border/40 font-mono tabular-nums">
                <td className="py-1 pr-3">{holding.symbol}</td>
                <td className="pr-3 text-right">{holding.quantity}</td>
                <td className="pr-3 text-right">{rupees(holding.avgCost)}</td>
                <td className="pr-3 text-right">{rupees(holding.invested)}</td>
                <td className="pr-3" title={`Oldest open lot bought ${holding.oldestLotDate}`}>
                  {holding.ltcgEligibleFrom}{holding.lots > 1 && <span className="text-muted-foreground"> · all {holding.lots} lots {holding.fullyLtcgEligibleFrom}</span>}
                </td>
                <td className="pr-3">
                  <input type="number" inputMode="decimal" min="0" step="0.05" aria-label={`Current price of ${holding.symbol}`} placeholder="₹"
                    value={priceText[holding.symbol] ?? ""} onChange={(event) => setPrice(holding.symbol, event.target.value)}
                    className="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-right" />
                </td>
                <td className="text-right">{price === undefined ? "—" : signed(holding.quantity * price - holding.invested)}</td>
              </tr>;
            })}</tbody>
          </table>
          {analysis.holdings.length === 0 && <p className="py-2 text-muted-foreground">Every position in the file is closed.</p>}
        </div>
      </TabsContent>

      <TabsContent value="realised" className="mt-3">
        {financialYear === undefined || !tax ? <p className="text-muted-foreground">No sells were matched, so nothing is realised yet.</p> : <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-muted-foreground">Financial year
              <select aria-label="Financial year" value={financialYear} onChange={(event) => setFinancialYear(Number(event.target.value))}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-foreground">
                {analysis.financialYears.map((year) => <option key={year} value={year}>{financialYearLabel(year)}</option>)}
              </select>
            </label>
            <span>Realised in {financialYearLabel(financialYear)}: <strong data-testid="realised-total" className="font-mono tabular-nums">{rupees(realisedTotal)}</strong></span>
            <span className="ml-auto"><ExportButton fileName={`realised-${financialYear}-${String(financialYear + 1).slice(-2)}.csv`} rows={[
              ["symbol", "quantity", "buy_date", "sell_date", "buy_value", "sell_value", "gain", "term"],
              ...trips.map((trip) => [trip.symbol, trip.quantity, trip.buyDate, trip.sellDate, fixed(trip.buyValue), fixed(trip.sellValue), fixed(trip.gain), trip.term]),
            ]} /></span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left">
              <thead><tr className="border-b border-border">
                <th className="py-1 pr-3">Symbol</th><th className="pr-3 text-right">Qty</th><th className="pr-3">Bought → sold</th>
                <th className="pr-3 text-right">Buy value</th><th className="pr-3 text-right">Sell value</th><th className="pr-3 text-right">Gain</th><th>Term</th>
              </tr></thead>
              <tbody>{trips.map((trip, index) => <tr key={index} className="border-b border-border/40 font-mono tabular-nums">
                <td className="py-1 pr-3">{trip.symbol}</td><td className="pr-3 text-right">{trip.quantity}</td><td className="pr-3">{trip.buyDate} → {trip.sellDate}</td>
                <td className="pr-3 text-right">{rupees(trip.buyValue)}</td><td className="pr-3 text-right">{rupees(trip.sellValue)}</td>
                <td className="pr-3 text-right">{signed(trip.gain)}</td><td>{trip.term}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <h3 className="mt-4 font-semibold">Tax · estimate, not tax advice</h3>
          <div className="mt-1 grid gap-x-8 md:grid-cols-2"><CapitalGainsFigures tax={tax} /></div>
          <p className="mt-2 text-[11px] text-muted-foreground">Same estimator as the portfolio page, applied to this file only: holdings outside the file, brought-forward losses and surcharge are not included.</p>
          <details className="mt-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer text-foreground">Calculation &amp; assumptions</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">{tax.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
            <CapitalGainsBuckets tax={tax} />
          </details>
        </>}
      </TabsContent>

      <TabsContent value="cash" className="mt-3">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
          <dl className="min-w-64">
            <Figure label="XIRR · annualised, gross" value={cash.xirr === null ? "—" : percent(cash.xirr)} />
            <Figure label={`Holdings value · ${asOf}`} value={cash.missing.length > 0 ? "—" : rupees(holdingsValue)} />
          </dl>
          <p data-testid="xirr-status" className="max-w-md text-muted-foreground">
            {cash.missing.length > 0 ? `Enter a current price for ${cash.missing.join(", ")} on the Holdings tab to compute XIRR.`
              : cash.xirr === null ? "XIRR is undefined for these cash flows (they need both money in and money out)."
              : "Buys are outflows and sells inflows on their trade dates; open holdings count as an inflow today at the prices entered."}
          </p>
          <span className="ml-auto"><ExportButton fileName="cash-flows.csv" rows={[["date", "amount", "description"], ...cash.flows.map((flow) => [flow.date, fixed(flow.amount), flow.label])]} /></span>
        </div>
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full whitespace-nowrap text-left">
            <thead className="sticky top-0 bg-panel"><tr className="border-b border-border"><th className="py-1 pr-3">Date</th><th className="pr-3">Flow</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{cash.flows.map((flow, index) => <tr key={index} className="border-b border-border/40 font-mono tabular-nums">
              <td className="py-1 pr-3">{flow.date}</td><td className="pr-3">{flow.label}</td><td className="text-right">{signed(flow.amount)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </TabsContent>
    </Tabs>
  </section>;
}
