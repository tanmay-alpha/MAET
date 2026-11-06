import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen";

function createTestRouter() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient() },
  });
}

// The strategy list page renders no <Outlet />, so any strategy page nested under it
// would match but never render. Each page must sit directly under the app shell.
describe("strategy routes", () => {
  test.each([
    ["/strategies/$strategyId", "/strategies/abc"],
    ["/strategies/$strategyId/backtests", "/strategies/abc/backtests"],
    ["/strategies/$strategyId/deployments", "/strategies/abc/deployments"],
  ] as const)("%s resolves to its own page under the app shell", (to, href) => {
    const router = createTestRouter();
    const location = router.buildLocation({ to, params: { strategyId: "abc" } });
    expect(location.pathname).toBe(href);

    const matches = router.matchRoutes(location.pathname).map((match) => match.routeId);
    expect(matches.slice(0, 2)).toEqual(["__root__", "/_app"]);
    expect(matches).toHaveLength(3);
    expect(String(matches[2]).replace(/\/$/, "")).toBe(`/_app${to}`);
  });

  test("the strategy list keeps its URL", () => {
    const router = createTestRouter();
    const matches = router.matchRoutes("/strategies").map((match) => match.routeId);
    expect(matches).toHaveLength(3);
    expect(String(matches[2]).replace(/\/$/, "")).toBe("/_app/strategies");
  });
});
