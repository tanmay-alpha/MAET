import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "../../routeTree.gen";
import { chartGeometry, compareRunIds, MAX_COMPARE_RUNS, parseCompareSearch, toggleRun } from "./selection";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";

describe("compare selection", () => {
  test("keeps valid distinct ids in order, at most four", () => {
    expect(compareRunIds(`${A}, ${B.toUpperCase()},not-an-id,${A},${C},${D},${E}`)).toEqual([A, B, C, D]);
    expect(compareRunIds(undefined)).toEqual([]);
    expect(compareRunIds(["x"])).toEqual([]);
  });

  test("the search validator drops the param when no id is valid", () => {
    expect(parseCompareSearch({ runs: `${A},${B}` })).toEqual({ runs: `${A},${B}` });
    expect(parseCompareSearch({ runs: "junk" })).toEqual({});
    expect(parseCompareSearch({})).toEqual({});
  });

  test("toggling adds up to the limit and removes", () => {
    let selected: string[] = [];
    for (const id of [A, B, C, D, E]) selected = toggleRun(selected, id);
    expect(selected).toEqual([A, B, C, D]);
    expect(selected).toHaveLength(MAX_COMPARE_RUNS);
    expect(toggleRun(selected, B)).toEqual([A, C, D]);
  });
});

describe("chart geometry", () => {
  test("scales all series to one shared range", () => {
    const { min, max, lines, scaleY } = chartGeometry([[100, 110], [100, 90]]);
    expect([min, max]).toEqual([90, 110]);
    expect(lines).toEqual(["0.000,50.000 100.000,0.000", "0.000,50.000 100.000,100.000"]);
    expect(scaleY(105)).toBe(25);
  });

  test("a single common date is drawn in the middle; no data draws nothing", () => {
    expect(chartGeometry([[100]]).lines).toEqual(["50.000,50.000"]);
    const empty = chartGeometry([[], []]);
    expect([empty.min, empty.max, empty.lines]).toEqual([0, 0, ["", ""]]);
  });
});

describe("research report routes", () => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }), context: { queryClient: new QueryClient() } });
  test.each([
    ["/research/reports", "/_app/research/reports/"],
    [`/research/reports/${A}`, "/_app/research/reports/$jobId"],
    ["/research/reports/compare", "/_app/research/reports/compare"],
  ])("%s renders its own page under the app shell", (path, routeId) => {
    const matches = router.matchRoutes(path).map((m) => m.routeId);
    expect(matches).toEqual(["__root__", "/_app", routeId]);
  });
});
