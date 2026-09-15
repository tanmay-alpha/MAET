import React from "react";
import { AlertTriangle, ShieldCheck, ShieldAlert, Zap, Layers, BarChart2 } from "lucide-react";
import type { ParameterStabilityAnalysis } from "../../../server/domain/strategy/robustness";

interface Props {
  analysis: ParameterStabilityAnalysis;
  paramXName?: string;
  paramYName?: string;
}

export function RobustnessHeatmapView({
  analysis,
  paramXName = "Param 1",
  paramYName = "Param 2",
}: Props) {
  const { robustnessScore, flags, isFragileSpike, heatmapMatrix } = analysis;

  // Extract unique X and Y coordinates for the heatmap
  const xValues = Array.from(new Set((heatmapMatrix ?? []).map((p) => p.paramX))).sort((a, b) => a - b);
  const yValues = Array.from(new Set((heatmapMatrix ?? []).map((p) => p.paramY))).sort((a, b) => a - b);

  // Min and max Sharpe for heatmap color scale
  const sharpeVals = (heatmapMatrix ?? []).map((p) => p.sharpe);
  const minSharpe = Math.min(...sharpeVals, 0);
  const maxSharpe = Math.max(...sharpeVals, 1);
  const sharpeRange = maxSharpe - minSharpe || 1;

  const getHeatmapColor = (sharpe: number) => {
    const norm = Math.max(0, Math.min(1, (sharpe - minSharpe) / sharpeRange));
    if (sharpe <= 0) {
      return `rgba(239, 68, 68, ${0.15 + (1 - norm) * 0.4})`; // Bear red
    }
    return `rgba(16, 185, 129, ${0.15 + norm * 0.65})`; // Bull green
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-bull";
    if (score >= 45) return "text-amber-500";
    return "text-bear";
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Robustness Score & Overfit Risk */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground uppercase">
            <span>Robustness Score</span>
            {robustnessScore.overallRobustnessScore >= 65 ? (
              <ShieldCheck className="h-4 w-4 text-bull" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-bear" />
            )}
          </div>
          <p className={`text-2xl font-bold font-mono mt-1 ${getScoreColor(robustnessScore.overallRobustnessScore)}`}>
            {robustnessScore.overallRobustnessScore.toFixed(0)} / 100
          </p>
          <span className="text-xs text-muted-foreground">
            {isFragileSpike ? "⚠️ Fragile Peak Detected" : "Stable Plateau Verified"}
          </span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground uppercase">
            <span>Peak vs Neighbors</span>
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold font-mono text-bull">{analysis.bestSharpe.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">peak Sharpe</span>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {analysis.neighborAverageSharpe.toFixed(2)} avg adjacent ({analysis.neighborCount} neighbors)
          </span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground uppercase">
            <span>Stability Breakdown</span>
            <BarChart2 className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Neighbors:</span>
              <span className="font-mono">{robustnessScore.neighborStabilityScore.toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Drawdown:</span>
              <span className="font-mono">{robustnessScore.drawdownStabilityScore.toFixed(0)}%</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground uppercase">
            <span>Safeguards & Flags</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {flags.length === 0 ? (
              <span className="inline-flex items-center gap-1 rounded bg-bull/10 px-2 py-0.5 text-xs font-semibold text-bull">
                No Safeguard Violations
              </span>
            ) : (
              flags.map((flag) => (
                <span
                  key={flag}
                  className="inline-flex items-center gap-1 rounded bg-bear/10 px-2 py-0.5 text-[10px] font-mono font-bold text-bear"
                >
                  {flag.replace(/_/g, " ")}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 2D Heatmap Grid */}
      {heatmapMatrix && heatmapMatrix.length > 0 && xValues.length > 0 && yValues.length > 0 && (
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Parameter Sensitivity Heatmap</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {paramXName} vs {paramYName} (Sharpe Ratio)
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="inline-block min-w-full">
              <table className="border-collapse text-xs font-mono">
                <thead>
                  <tr>
                    <th className="p-2 text-left text-muted-foreground">{paramYName} \ {paramXName}</th>
                    {xValues.map((x) => (
                      <th key={x} className="p-2 text-center text-muted-foreground font-semibold">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {yValues.map((y) => (
                    <tr key={y}>
                      <td className="p-2 font-semibold text-muted-foreground text-right">{y}</td>
                      {xValues.map((x) => {
                        const cell = heatmapMatrix.find((c) => c.paramX === x && c.paramY === y);
                        if (!cell) {
                          return <td key={x} className="p-2 border border-border/30 bg-muted/20" />;
                        }
                        const isBest =
                          analysis.bestParams[paramXName] === x && analysis.bestParams[paramYName] === y;
                        return (
                          <td
                            key={x}
                            className={`p-2.5 text-center border border-border/40 transition-transform hover:scale-105 cursor-pointer relative ${
                              isBest ? "ring-2 ring-primary font-bold shadow-lg" : ""
                            }`}
                            style={{ backgroundColor: getHeatmapColor(cell.sharpe) }}
                            title={`${paramXName}: ${x}, ${paramYName}: ${y}\nSharpe: ${cell.sharpe.toFixed(2)}\nReturn: ${(cell.totalReturn * 100).toFixed(1)}%`}
                          >
                            <span className={cell.sharpe > 0 ? "text-foreground" : "text-bear font-bold"}>
                              {cell.sharpe.toFixed(2)}
                            </span>
                            {isBest && (
                              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
