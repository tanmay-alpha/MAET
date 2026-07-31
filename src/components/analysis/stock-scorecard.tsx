import React from "react";

export interface StockScorecardProps {
  scorecard: {
    overall?: number;
    quality?: number;
    valuation?: number;
    growth?: number;
    momentum?: number;
    financialHealth?: number;
    risk?: number;
    confidence: number;
    coverage: number;
    methodVersion: string;
    asOf: string;
    provenance: string[];
    missingInputs: string[];
    strengths: string[];
    risks: string[];
  };
}

export function StockScorecard({ scorecard }: StockScorecardProps) {
  if (!scorecard) return null;

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h3 className="text-xl font-bold">Stock Scorecard</h3>
          <p className="text-xs text-muted-foreground">Version {scorecard.methodVersion} • As of {new Date(scorecard.asOf).toLocaleDateString()}</p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-extrabold text-primary">{scorecard.overall ?? "N/A"}</span>
          <p className="text-xs text-muted-foreground">Overall Rating</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <ScoreItem label="Quality" value={scorecard.quality} />
        <ScoreItem label="Valuation" value={scorecard.valuation} />
        <ScoreItem label="Growth" value={scorecard.growth} />
        <ScoreItem label="Momentum" value={scorecard.momentum} />
        <ScoreItem label="Financial Health" value={scorecard.financialHealth} />
        <ScoreItem label="Risk (Inverted)" value={scorecard.risk} />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground border-t pt-3">
        <span>Confidence: {(scorecard.confidence * 100).toFixed(0)}%</span>
        <span>Data Coverage: {(scorecard.coverage * 100).toFixed(0)}%</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {scorecard.strengths.length > 0 && (
          <div className="rounded bg-emerald-500/10 p-3 text-xs">
            <h4 className="font-semibold text-emerald-600 mb-1">Key Strengths</h4>
            <ul className="list-disc list-inside space-y-1 text-emerald-700">
              {scorecard.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {scorecard.risks.length > 0 && (
          <div className="rounded bg-rose-500/10 p-3 text-xs">
            <h4 className="font-semibold text-rose-600 mb-1">Key Risks</h4>
            <ul className="list-disc list-inside space-y-1 text-rose-700">
              {scorecard.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreItem({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded border p-3 bg-background">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-lg font-bold">{value !== undefined ? value : "N/A"}</p>
    </div>
  );
}
