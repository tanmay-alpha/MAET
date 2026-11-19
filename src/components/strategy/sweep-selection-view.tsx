import type { SweepSelection } from "../../../server/modules/strategy-optimisation/sweep-robustness";

export const PBO_EXPLANATION =
  "Probability that the best in-sample parameter set underperforms the median out of sample; values near or above 0.5 mean the selection is likely overfit.";

/** How the sweep's best row was picked, and its probability of backtest overfitting (CSCV). */
export function SweepSelectionView({ selection }: { selection: SweepSelection }) {
  const pbo = selection.pbo;
  const overfit = pbo !== null && pbo.pbo >= 0.5;
  return (
    <section aria-labelledby="sweep-selection" className="rounded border border-border px-3 py-2 text-xs">
      <h3 id="sweep-selection" className="font-medium text-muted-foreground">
        Selection: retrospective in-sample pick of the best Sharpe among {selection.trials} parameter sets
      </h3>
      <p className="mt-1.5">
        <span className="text-muted-foreground">Probability of backtest overfitting (PBO): </span>
        {pbo === null ? (
          <span data-testid="sweep-pbo">not computed. {selection.pboReason ?? "No reason was recorded."}</span>
        ) : (
          <span data-testid="sweep-pbo" className={`font-mono ${overfit ? "text-bear" : ""}`}>
            {pbo.pbo.toFixed(2)}
            <span className="font-sans text-muted-foreground"> · {pbo.splits} in-/out-of-sample splits over {pbo.blocks} blocks{overfit ? " · likely overfit" : ""}</span>
          </span>
        )}
      </p>
      <p className="mt-1 text-muted-foreground">{PBO_EXPLANATION}</p>
    </section>
  );
}
