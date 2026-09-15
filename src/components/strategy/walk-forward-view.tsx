import React, { useId } from "react";
import { Activity, ShieldCheck, AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import type { WalkForwardAnalysisResult } from "../../../server/domain/strategy/walk-forward";

interface Props {
  result: WalkForwardAnalysisResult;
}

export function WalkForwardView({ result }: Props) {
  const gradientId = useId().replace(/:/g, "");
  const oosPoints = result.aggregateOosEquityCurve ?? [];
  const minEquity = oosPoints.length > 0 ? Math.min(...oosPoints.map((p) => p.equity)) : 100000;
  const maxEquity = oosPoints.length > 0 ? Math.max(...oosPoints.map((p) => p.equity)) : 100000;
  const spread = maxEquity - minEquity || 1;

  const pointsStr = oosPoints
    .map((p, idx) => `${(idx / (oosPoints.length - 1)) * 100},${100 - ((p.equity - minEquity) / spread) * 100}`)
    .join(" ");

  const isProfitable = result.summary.oosReturnTotal >= 0;
  const strokeColor = isProfitable ? "var(--color-bull)" : "var(--color-bear)";

  return (
    <div className="space-y-6">
      {/* Headline banner emphasizing OOS performance */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Out-of-Sample (OOS) Walk-Forward Evaluation
          </span>
          <h2 className="text-xl font-bold font-mono mt-1">
            {(result.summary.oosReturnTotal * 100).toFixed(2)}% OOS Return
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Parameters strictly selected on past training/validation windows; tested on unseen forward bars.
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div>
            <span className="text-[10px] uppercase text-muted-foreground">OOS Sharpe</span>
            <p className="text-base font-bold font-mono text-bull">{result.summary.oosSharpeAvg.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase text-muted-foreground">OOS Max DD</span>
            <p className="text-base font-bold font-mono text-bear">
              {(result.summary.oosDrawdownMax * 100).toFixed(2)}%
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase text-muted-foreground">Retention</span>
            <p className="text-base font-bold font-mono">
              {(result.summary.performanceRetention * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase text-muted-foreground">WFE Ratio</span>
            <p className="text-base font-bold font-mono">
              {result.summary.walkForwardEfficiency.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Aggregate OOS Equity Curve */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Aggregate Out-of-Sample (OOS) Equity Curve</span>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {result.windows.length} Concatenated OOS Windows
          </span>
        </div>

        <div className="h-64 mt-3 w-full">
          {oosPoints.length > 1 ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline points={`0,100 ${pointsStr} 100,100`} fill={`url(#${gradientId})`} stroke="none" />
              <polyline points={pointsStr} fill="none" stroke={strokeColor} strokeWidth="0.8" />
            </svg>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              No OOS equity curve data available
            </div>
          )}
        </div>
      </div>

      {/* Per-Window Breakdown Table */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card">
          <span className="text-sm font-semibold">Walk-Forward Window Breakdown (Train → Val → Test)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-panel border-b border-border text-[11px] text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Window</th>
                <th className="px-4 py-2.5">Train Dates</th>
                <th className="px-4 py-2.5">Val Dates</th>
                <th className="px-4 py-2.5">Test (OOS) Dates</th>
                <th className="px-4 py-2.5">Chosen Params</th>
                <th className="px-4 py-2.5">IS Sharpe</th>
                <th className="px-4 py-2.5">Val Sharpe</th>
                <th className="px-4 py-2.5">OOS Sharpe</th>
                <th className="px-4 py-2.5">OOS Return</th>
                <th className="px-4 py-2.5">OOS DD</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {result.windows.map((w) => (
                <tr key={w.windowNumber} className="hover:bg-panel/50">
                  <td className="px-4 py-2.5 font-bold">W{w.windowNumber}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-[10px]">
                    {w.trainDates.from.slice(0, 10)} → {w.trainDates.to.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-[10px]">
                    {w.valDates.from.slice(0, 10)} → {w.valDates.to.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-primary text-[10px] font-semibold">
                    {w.testDates.from.slice(0, 10)} → {w.testDates.to.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-foreground">
                    {JSON.stringify(w.selectedParameters).replace(/[{}"]/g, "")}
                  </td>
                  <td className="px-4 py-2.5">{w.isMetrics.sharpe.toFixed(2)}</td>
                  <td className="px-4 py-2.5">{w.valMetrics.sharpe.toFixed(2)}</td>
                  <td className={`px-4 py-2.5 font-bold ${w.oosMetrics.sharpe >= 0 ? "text-bull" : "text-bear"}`}>
                    {w.oosMetrics.sharpe.toFixed(2)}
                  </td>
                  <td className={`px-4 py-2.5 font-bold ${w.oosMetrics.totalReturn >= 0 ? "text-bull" : "text-bear"}`}>
                    {(w.oosMetrics.totalReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-bear">{(w.oosMetrics.maxDrawdown * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2.5">
                    {w.validationAccepted ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-bull font-sans">
                        <ShieldCheck className="h-3 w-3" /> Validated
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-bear font-sans">
                        <AlertTriangle className="h-3 w-3" /> Rejected
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
