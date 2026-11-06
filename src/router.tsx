import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { retryUnlessUnauthenticated } from "./lib/trpc";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: retryUnlessUnauthenticated } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
