import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { SweepSelection } from "../../../server/modules/strategy-optimisation/sweep-robustness";
import { PBO_EXPLANATION, SweepSelectionView } from "./sweep-selection-view";

const base = { sample: "IN_SAMPLE", method: "RETROSPECTIVE_BEST_SHARPE", trials: 12 } as const;
const text = (selection: SweepSelection) => renderToString(<SweepSelectionView selection={selection} />).replace(/<!-- -->/g, "");

describe("SweepSelectionView", () => {
  test("shows PBO, trials and the retrospective in-sample label with the explanation", () => {
    const html = text({ ...base, pbo: { pbo: 0.625, trials: 12, blocks: 16, splits: 12870, medianLogit: -0.4 }, pboReason: null });
    expect(html).toContain("retrospective in-sample pick of the best Sharpe among 12 parameter sets");
    expect(html).toContain("0.63");
    expect(html).toContain("12870 in-/out-of-sample splits over 16 blocks");
    expect(html).toContain("blocks · likely overfit");
    expect(html).toContain(PBO_EXPLANATION);
  });

  test("does not flag a low PBO as overfit", () => {
    const html = text({ ...base, pbo: { pbo: 0.1, trials: 12, blocks: 16, splits: 12870, medianLogit: 1.2 }, pboReason: null });
    expect(html).toContain("0.10");
    expect(html).not.toContain("blocks · likely overfit");
  });

  test("shows the reason when PBO could not be computed", () => {
    const html = text({ ...base, trials: 1, pbo: null, pboReason: "PBO needs at least two parameter sets" });
    expect(html).toContain("not computed. PBO needs at least two parameter sets");
    expect(html).toContain("among 1 parameter sets");
    expect(html).toContain(PBO_EXPLANATION);
  });
});
