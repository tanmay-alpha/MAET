import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export function useResearchWorkspace() {
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["workspace", "overview"],
    queryFn: () => trpc.workspace.getOverview.query(),
  });

  const watchlistsQuery = useQuery({
    queryKey: ["workspace", "watchlists"],
    queryFn: () => trpc.workspace.listWatchlists.query(),
  });

  const savedScreenersQuery = useQuery({
    queryKey: ["workspace", "savedScreeners"],
    queryFn: () => trpc.workspace.listSavedScreeners.query(),
  });

  const recentRunsQuery = useQuery({
    queryKey: ["workspace", "recentRuns"],
    queryFn: () => trpc.workspace.listRecentRuns.query(),
  });

  const createWatchlistMutation = useMutation({
    mutationFn: (name: string) => trpc.workspace.createWatchlist.mutate({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const addWatchlistItemMutation = useMutation({
    mutationFn: (data: { watchlistId: string; symbol: string; exchange?: "NSE" | "BSE" }) =>
      trpc.workspace.addWatchlistItem.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const removeWatchlistItemMutation = useMutation({
    mutationFn: (itemId: string) => trpc.workspace.removeWatchlistItem.mutate({ itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const saveScreenerMutation = useMutation({
    mutationFn: (data: { name: string; criteria: Record<string, any>; description?: string }) =>
      trpc.workspace.saveScreener.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const deleteScreenerMutation = useMutation({
    mutationFn: (screenerId: string) => trpc.workspace.deleteScreener.mutate({ screenerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  return {
    overview: overviewQuery.data,
    watchlists: watchlistsQuery.data?.items ?? [],
    savedScreeners: savedScreenersQuery.data ?? [],
    recentRuns: recentRunsQuery.data ?? [],
    isLoading: overviewQuery.isLoading || watchlistsQuery.isLoading,
    createWatchlist: createWatchlistMutation.mutateAsync,
    addWatchlistItem: addWatchlistItemMutation.mutateAsync,
    removeWatchlistItem: removeWatchlistItemMutation.mutateAsync,
    saveScreener: saveScreenerMutation.mutateAsync,
    deleteScreener: deleteScreenerMutation.mutateAsync,
  };
}
