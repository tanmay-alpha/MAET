import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/compare")({
  head: () => ({ meta: [{ title: "Compare — MAET" }] }),
  component: Compare,
});

function Compare() {
  const [symbols, setSymbols] = useState<string[]>(["RELIANCE", "TCS"]);
  const [input, setInput] = useState("");

  const addSymbol = () => {
    if (input && !symbols.includes(input.toUpperCase())) {
      setSymbols([...symbols, input.toUpperCase()]);
      setInput("");
    }
  };

  const removeSymbol = (symbol: string) => {
    setSymbols(symbols.filter((s) => s !== symbol));
  };

  if (symbols.length < 2) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <EmptyState
            title="Compare stocks"
            description="Add at least 2 symbols to compare their metrics side-by-side."
            action={{
              label: "Add first symbol",
              onClick: () => {
                const sym = prompt("Enter symbol (e.g., RELIANCE):");
                if (sym) setSymbols([sym.toUpperCase()]);
              },
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <h1 className="text-lg font-semibold">Compare</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSymbol()}
            placeholder="Add symbol..."
            className="w-40 rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={addSymbol}
            className="rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Symbol tabs */}
      <div className="flex items-center gap-1 border-b border-border bg-panel px-2">
        {symbols.map((s) => (
          <div
            key={s}
            className="flex items-center gap-1 rounded-t bg-panel px-3 py-2 text-sm"
          >
            <span className="font-semibold">{s}</span>
            <button
              onClick={() => removeSymbol(s)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Metric</th>
              {symbols.map((s) => (
                <th key={s} className="px-4 py-2 text-center font-medium">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Price</td>
              {symbols.map((s) => (
                <td key={s} className="px-4 py-2 text-center font-mono tabular">
                  <Link to={`/chart/${s}`} className="text-primary hover:underline">
                    {s === "RELIANCE" ? "₹2,450" : s === "TCS" ? "₹3,520" : "—"}
                  </Link>
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Change %</td>
              {symbols.map((s) => (
                <td key={s} className="px-4 py-2 text-center font-mono tabular">
                  <span className="text-bull">+1.2%</span>
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Market Cap</td>
              {symbols.map((s) => (
                <td key={s} className="px-4 py-2 text-center font-mono tabular">
                  {s === "RELIANCE" ? "₹16.5T" : s === "TCS" ? "₹13.2T" : "—"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">P/E Ratio</td>
              {symbols.map((s) => (
                <td key={s} className="px-4 py-2 text-center font-mono tabular">
                  {s === "RELIANCE" ? "24.5" : s === "TCS" ? "28.3" : "—"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">EPS (TTM)</td>
              {symbols.map((s) => (
                <td key={s} className="px-4 py-2 text-center font-mono tabular">
                  {s === "RELIANCE" ? "₹98.5" : s === "TCS" ? "₹124.2" : "—"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Sector</td>
              {symbols.map((s) => (
                <td key={s} className="px-4 py-2 text-center">
                  {s === "RELIANCE" ? "Energy" : s === "TCS" ? "Technology" : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Fundamental data provider pending — showing demo data" />
      </div>
    </div>
  );
}
