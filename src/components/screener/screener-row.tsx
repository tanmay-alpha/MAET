import { useNavigate } from "@tanstack/react-router";
import { Building2, CandlestickChart, Copy, ExternalLink, MoreHorizontal, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MarketCompany, MarketQuote } from "@/lib/market-api";
import { getTradingViewUrl } from "@/lib/tradingview";

export type QuoteMap = ReadonlyMap<string, MarketQuote>;

export type ScreenerColumn = {
  id: string;
  label: string;
  align?: "left" | "right";
  sortBy?: string;
  /** Filled from the NSE company master or live quotes, so it still has data with the database offline. */
  offline?: true;
  /** Extra classes for the header and body cells, e.g. to hide the column on narrow screens. */
  cellClass?: string;
  render: (company: MarketCompany, quotes: QuoteMap) => ReactNode;
};

function RowActions({ company, screenerRunId }: { company: MarketCompany; screenerRunId: string }) {
  const navigate = useNavigate();
  const { symbol } = company;
  const exchange = company.exchange || "NSE";
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => void navigate({
          to: "/terminal",
          search: { symbol, exchange, companyId: symbol, sourceContext: "screener", screenerRunId },
        })}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:border-primary/50 hover:text-primary"
        title={`Open ${symbol} in the terminal to chart and paper trade`}
      >
        <CandlestickChart className="h-3.5 w-3.5" />Terminal
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label={`More actions for ${symbol}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem] text-xs [&_[role=menuitem]]:text-xs">
          <DropdownMenuItem
            onSelect={() => void navigate({
              to: "/chart/$symbol",
              params: { symbol },
              search: { exchange, sourceContext: "screener" },
            })}
          >
            <TrendingUp />Full chart
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigate({ to: "/stock/$symbol", params: { symbol } })}>
            <Building2 />Company page
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={getTradingViewUrl(symbol)} target="_blank" rel="noreferrer">
              <ExternalLink />TradingView
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(symbol)}>
            <Copy />Copy symbol
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ScreenerRow({ company, rank, columns, quotes, screenerRunId }: {
  company: MarketCompany;
  rank: number;
  columns: ScreenerColumn[];
  quotes: QuoteMap;
  screenerRunId: string;
}) {
  const navigate = useNavigate();
  const cell = (column: ScreenerColumn): ReactNode => {
    if (column.id === "rank") return <span className="text-muted-foreground">{rank}</span>;
    if (column.id !== "company") return column.render(company, quotes);
    return (
      <button
        type="button"
        onClick={() => void navigate({ to: "/stock/$symbol", params: { symbol: company.symbol } })}
        className="flex min-w-[150px] items-center gap-2 text-left sm:min-w-[220px]"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-primary">{company.symbol}</span>
          <span className="block max-w-[180px] truncate font-sans text-[11px] text-foreground/80 sm:max-w-[210px]">{company.name}</span>
        </span>
        {company.marketCapBucket !== "unknown" && (
          <span className="rounded bg-accent px-1 py-0.5 text-[9px] uppercase text-muted-foreground">{company.marketCapBucket}</span>
        )}
      </button>
    );
  };
  return (
    <tr className="hover:bg-accent/35">
      {columns.map((column) => (
        <td
          key={column.id}
          className={`whitespace-nowrap border-b border-border/40 px-3 py-2 font-mono tabular-nums ${column.align === "right" ? "text-right" : "text-left"} ${column.cellClass ?? ""}`}
        >
          {cell(column)}
        </td>
      ))}
      <td className="border-b border-border/40 px-3 py-2">
        <RowActions company={company} screenerRunId={screenerRunId} />
      </td>
    </tr>
  );
}
