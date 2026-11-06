import type { ParameterStabilityAnalysis } from "../../../server/domain/strategy/robustness";
import { MetricGrid } from "./page-chrome";

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

  const score = robustnessScore.overallRobustnessScore;

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Robustness</h3>
        <MetricGrid
          label="Sweep robustness"
          items={[
            { label: "Robustness score", value: `${score.toFixed(0)} / 100`, tone: score >= 70 ? "text-bull" : score >= 45 ? "text-amber-400" : "text-bear" },
            { label: "Best combination", value: isFragileSpike ? "Isolated spike" : "Neighbours hold up", tone: isFragileSpike ? "text-bear" : "" },
            { label: "Peak Sharpe", value: analysis.bestSharpe.toFixed(2) },
            { label: `Neighbour avg Sharpe (${analysis.neighborCount})`, value: analysis.neighborAverageSharpe.toFixed(2) },
            { label: "Neighbour stability", value: `${robustnessScore.neighborStabilityScore.toFixed(0)}%` },
            { label: "Drawdown stability", value: `${robustnessScore.drawdownStabilityScore.toFixed(0)}%` },
          ]}
        />
        <p className={`mt-1.5 text-xs ${flags.length ? "text-bear" : "text-muted-foreground"}`}>
          Flags: {flags.length === 0 ? "none" : flags.map((flag) => flag.replace(/_/g, " ").toLowerCase()).join(", ")}
        </p>
      </section>

      {heatmapMatrix && heatmapMatrix.length > 0 && xValues.length > 0 && yValues.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
            Sharpe by {paramYName} (rows) and {paramXName} (columns) · outlined cell is the best combination
          </h3>
          <div className="overflow-x-auto">
            <table className="border-collapse font-mono text-xs">
              <thead>
                <tr>
                  <th className="p-1.5 text-left font-normal text-muted-foreground">{paramYName} \ {paramXName}</th>
                  {xValues.map((x) => (
                    <th key={x} className="p-1.5 text-center font-normal text-muted-foreground">{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {yValues.map((y) => (
                  <tr key={y}>
                    <td className="p-1.5 text-right text-muted-foreground">{y}</td>
                    {xValues.map((x) => {
                      const cell = heatmapMatrix.find((c) => c.paramX === x && c.paramY === y);
                      if (!cell) {
                        return <td key={x} className="border border-border/30 p-1.5" />;
                      }
                      const isBest = analysis.bestParams[paramXName] === x && analysis.bestParams[paramYName] === y;
                      return (
                        <td
                          key={x}
                          className={`border border-border/40 px-2 py-1.5 text-center ${isBest ? "outline outline-2 -outline-offset-2 outline-primary font-semibold" : ""}`}
                          style={{ backgroundColor: getHeatmapColor(cell.sharpe) }}
                          title={`${paramXName} ${x}, ${paramYName} ${y}: Sharpe ${cell.sharpe.toFixed(2)}, return ${cell.totalReturn.toFixed(1)}%`}
                        >
                          {cell.sharpe.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
