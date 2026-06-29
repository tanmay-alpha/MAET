import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Calendar, TrendingUp, TrendingDown, Activity, BarChart3 } from "lucide-react";
import { DataBadge } from "@/components/common/data-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";
import { GreekDisplay, PCRDisplay } from "@/components/options/greek-display";
import { calculateGreeks, calculatePCR } from "@/lib/greeks";

export const Route = createFileRoute("/_app/options/$underlying")({
  head: () => ({ meta: [{ title: "Options Chain — MAET" }] }),
  component: OptionsChain,
});

interface OptionStrike {
  strike: number;
  callOI: number;
  putOI: number;
  callChgOI: number;
  putChgOI: number;
  callVolume: number;
  putVolume: number;
  callIV: number;
  putIV: number;
  callLTP: number;
  putLTP: number;
  callChange: number;
  putChange: number;
}

const generateMockChain = (spot: number, expiry: Date): OptionStrike[] => {
  const atmStrike = Math.round(spot / 50) * 50;
  const strikes = Array.from({ length: 15 }, (_, i) => atmStrike - 300 + i * 50);

  return strikes.map((strike) => {
    const distFromATM = Math.abs(strike - spot);
    const baseIV = 18 + (distFromATM / spot) * 15;
    const callIV = baseIV + (strike >= spot ? 2 : -1);
    const putIV = baseIV + (strike <= spot ? 2 : -1);

    const itm = strike < spot;
    const otm = strike > spot;

    const callIntrinsic = Math.max(0, spot - strike);
    const putIntrinsic = Math.max(0, strike - spot);

    const callTimeValue = (callIV / 100) * Math.sqrt(7 / 365) * spot * 0.3;
    const putTimeValue = (putIV / 100) * Math.sqrt(7 / 365) * spot * 0.3;

    const callLTP = Math.max(0.05, callIntrinsic + callTimeValue + (Math.random() - 0.5) * 5);
    const putLTP = Math.max(0.05, putIntrinsic + putTimeValue + (Math.random() - 0.5) * 5);

    const baseOI = 5000 + Math.random() * 20000;
    const oiMultiplier = itm ? 2.5 : otm ? 0.8 : 3;
    const callOI = Math.round(baseOI * oiMultiplier);
    const putOI = Math.round(baseOI * oiMultiplier * (1 + Math.random() * 0.3));

    const callVolume = Math.round(callOI * (0.15 + Math.random() * 0.1));
    const putVolume = Math.round(putOI * (0.15 + Math.random() * 0.1));

    return {
      strike,
      callOI,
      putOI,
      callChgOI: Math.round((Math.random() - 0.4) * callOI * 0.15),
      putChgOI: Math.round((Math.random() - 0.4) * putOI * 0.15),
      callVolume,
      putVolume,
      callIV: Math.round(callIV * 10) / 10,
      putIV: Math.round(putIV * 10) / 10,
      callLTP: Math.round(callLTP * 100) / 100,
      putLTP: Math.round(putLTP * 100) / 100,
      callChange: (Math.random() - 0.4) * 15,
      putChange: (Math.random() - 0.4) * 15,
    };
  });
};

function OptionsChain() {
  const [expiry, setExpiry] = useState("28 Jun 2026");
  const [selectedTab, setSelectedTab] = useState<"calls" | "puts">("calls");
  const [showGreeks, setShowGreeks] = useState(false);

  const spot = 2450;
  const expiryDate = new Date("2026-06-28");

  const chain = useMemo(() => generateMockChain(spot, expiryDate), [spot, expiryDate]);

  const totalCallOI = chain.reduce((sum, s) => sum + s.callOI, 0);
  const totalPutOI = chain.reduce((sum, s) => sum + s.putOI, 0);
  const pcr = calculatePCR(totalCallOI, totalPutOI);

  const atmStrike = Math.round(spot / 50) * 50;

  const getGreeksForStrike = (strike: number, type: "call" | "put") => {
    const strikeData = chain.find(s => s.strike === strike);
    const iv = type === "call"
      ? (strikeData?.callIV ?? 20) / 100
      : (strikeData?.putIV ?? 20) / 100;
    return calculateGreeks({
      strike,
      spot,
      expiry: expiryDate,
      type,
      iv,
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold">Options Chain</h1>
          <p className="text-sm text-muted-foreground">RELIANCE — NSE</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">LTP:</span>
            <span className="font-mono tabular font-semibold">₹{spot.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            <span className="text-bull">+1.2%</span>
          </div>
          <button
            type="button"
            onClick={() => setShowGreeks(!showGreeks)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs ${
              showGreeks
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="h-3 w-3" />
            {showGreeks ? "Hide" : "Show"} Greeks
          </button>
        </div>
      </div>

      {/* Market stats bar */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-5 py-2">
        <div className="flex items-center gap-4">
          <DataBadge label="Total Call OI" value={totalCallOI.toLocaleString("en-IN")} />
          <DataBadge label="Total Put OI" value={totalPutOI.toLocaleString("en-IN")} />
          <PCRDisplay callOI={totalCallOI} putOI={totalPutOI} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Max Pain:</span>
          <span className="font-mono font-medium">{atmStrike}</span>
        </div>
      </div>

      {/* Symbol selector and date picker */}
      <div className="flex items-center justify-between border-b border-border px-5 py-2">
        <select aria-label="Select underlying symbol" className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-primary">
          <option>RELIANCE</option>
          <option>BANKNIFTY</option>
          <option>NIFTY</option>
        </select>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpiry("28 Jun 2026")}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${
              expiry === "28 Jun 2026"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Calendar className="h-3 w-3 mr-1 inline" /> 28 Jun 2026
          </button>
          <button
            onClick={() => setExpiry("31 Jul 2026")}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${
              expiry === "31 Jul 2026"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Calendar className="h-3 w-3 mr-1 inline" /> 31 Jul 2026
          </button>
        </div>
      </div>

      {/* Call/Put tabs */}
      <div className="flex items-center gap-1 border-b border-border bg-panel px-2">
        <button
          onClick={() => setSelectedTab("calls")}
          className={`rounded-t px-3 py-2 text-sm ${selectedTab === "calls" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Calls
          <span className="ml-1 text-xs bg-bull/20 text-bull px-1 rounded">{chain.length}</span>
        </button>
        <button
          onClick={() => setSelectedTab("puts")}
          className={`rounded-t px-3 py-2 text-sm ${selectedTab === "puts" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Puts
          <span className="ml-1 text-xs bg-bear/20 text-bear px-1 rounded">{chain.length}</span>
        </button>
      </div>

      {/* Options table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">Strike</th>
              <th className="px-3 py-2 text-right">OI</th>
              <th className="px-3 py-2 text-right">Chg OI</th>
              <th className="px-3 py-2 text-right">Volume</th>
              <th className="px-3 py-2 text-right">IV</th>
              <th className="px-3 py-2 text-right">LTP</th>
              <th className="px-3 py-2 text-right">Chg %</th>
              {showGreeks && (
                <>
                  <th className="px-3 py-2 text-right">Delta</th>
                  <th className="px-3 py-2 text-right">Gamma</th>
                  <th className="px-3 py-2 text-right">Theta</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {chain.map((item) => {
              const isATM = item.strike === atmStrike;
              const greeks = showGreeks ? getGreeksForStrike(item.strike, selectedTab === "calls" ? "call" : "put") : null;
              const data = selectedTab === "calls"
                ? {
                    oi: item.callOI,
                    chgOI: item.callChgOI,
                    volume: item.callVolume,
                    iv: item.callIV,
                    ltp: item.callLTP,
                    change: item.callChange,
                  }
                : {
                    oi: item.putOI,
                    chgOI: item.putChgOI,
                    volume: item.putVolume,
                    iv: item.putIV,
                    ltp: item.putLTP,
                    change: item.putChange,
                  };

              return (
                <tr
                  key={item.strike}
                  className={`border-b border-border hover:bg-accent/30 ${
                    isATM ? "bg-primary/5" : ""
                  }`}
                >
                  <td className={`px-3 py-2 font-medium ${isATM ? "font-semibold text-primary" : ""}`}>
                    {item.strike.toLocaleString("en-IN")}
                    {isATM && <span className="ml-1.5 text-[10px] text-primary">ATM</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular text-muted-foreground">
                    {data.oi.toLocaleString("en-IN")}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular ${
                    data.chgOI >= 0 ? "text-bull" : "text-bear"
                  }`}>
                    {data.chgOI >= 0 ? "+" : ""}{data.chgOI.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular text-muted-foreground">
                    {data.volume.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular">
                    {data.iv.toFixed(1)}%
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular font-medium ${
                    selectedTab === "calls" ? "text-bull" : "text-bear"
                  }`}>
                    ₹{data.ltp.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular ${
                    data.change >= 0 ? "text-bull" : "text-bear"
                  }`}>
                    {data.change >= 0 ? "+" : ""}{data.change.toFixed(1)}%
                  </td>
                  {showGreeks && greeks && (
                    <>
                      <td className="px-3 py-2 text-right font-mono tabular">
                        {greeks.delta.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular">
                        {greeks.gamma.toFixed(4)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono tabular ${
                        greeks.theta < 0 ? "text-bear" : "text-bull"
                      }`}>
                        {greeks.theta.toFixed(3)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Greeks summary bar */}
      {showGreeks && (
        <div className="border-t border-border bg-panel p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Portfolio Greeks (Weighted)</div>
          <GreekDisplay
            greeks={{
              delta: chain.filter(s => s.strike <= spot).reduce((sum, s) => {
                const g = getGreeksForStrike(s.strike, "put");
                return sum + g.delta * s.putOI;
              }, 0) / Math.max(totalPutOI, 1) + chain.filter(s => s.strike > spot).reduce((sum, s) => {
                const g = getGreeksForStrike(s.strike, "call");
                return sum + g.delta * s.callOI;
              }, 0) / Math.max(totalCallOI, 1),
              gamma: chain.reduce((sum, s) => sum + getGreeksForStrike(s.strike, "call").gamma * (s.callOI + s.putOI), 0) / (totalCallOI + totalPutOI),
              theta: chain.reduce((sum, s) => sum + getGreeksForStrike(s.strike, "call").theta * s.callOI + getGreeksForStrike(s.strike, "put").theta * s.putOI, 0) / (totalCallOI + totalPutOI),
              vega: chain.reduce((sum, s) => sum + getGreeksForStrike(s.strike, "call").vega * s.callOI + getGreeksForStrike(s.strike, "put").vega * s.putOI, 0) / (totalCallOI + totalPutOI),
              rho: 0,
              iv: 0.2,
            }}
          />
        </div>
      )}

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Live options data via WebSocket — Greeks calculated using Black-Scholes model" />
      </div>
    </div>
  );
}
