import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import type { WorkspaceExchange } from "@/lib/trpc";

export function useResearchWorkspace() {
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["workspace", "overview"],
    queryFn: () => trpc.workspace.getOverview.query(),
  });

  const watchlistsQuery = useQuery({
    queryKey: ["workspace", "watchlists"],
    queryFn: () => trpc.workspace.listWatchlists.query({ limit: 50 }),
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

  const renameWatchlistMutation = useMutation({
    mutationFn: (input: { watchlistId: string; name: string }) =>
      trpc.workspace.renameWatchlist.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const deleteWatchlistMutation = useMutation({
    mutationFn: (watchlistId: string) => trpc.workspace.deleteWatchlist.mutate({ watchlistId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const addWatchlistItemMutation = useMutation({
    mutationFn: (input: { watchlistId: string; symbol: string; exchange?: WorkspaceExchange }) =>
      trpc.workspace.addWatchlistItem.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const updateWatchlistItemNoteMutation = useMutation({
    mutationFn: (input: { itemId: string; note: string | null }) =>
      trpc.workspace.updateWatchlistItemNote.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const reorderWatchlistItemsMutation = useMutation({
    mutationFn: (items: Array<{ itemId: string; position: number }>) =>
      trpc.workspace.reorderWatchlistItems.mutate({ items }),
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
    mutationFn: (input: { name: string; criteria: Record<string, unknown>; description?: string }) =>
      trpc.workspace.saveScreener.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const updateScreenerMutation = useMutation({
    mutationFn: (input: { screenerId: string; name?: string; criteria?: Record<string, unknown> }) =>
      trpc.workspace.updateScreener.mutate(input),
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
    savedScreenersLoading: savedScreenersQuery.isLoading,
    savedScreenersError: savedScreenersQuery.error,
    recentRuns: recentRunsQuery.data ?? [],
    isLoading: overviewQuery.isLoading || watchlistsQuery.isLoading,
    createWatchlist: createWatchlistMutation.mutateAsync,
    renameWatchlist: renameWatchlistMutation.mutateAsync,
    deleteWatchlist: deleteWatchlistMutation.mutateAsync,
    addWatchlistItem: addWatchlistItemMutation.mutateAsync,
    removeWatchlistItem: removeWatchlistItemMutation.mutateAsync,
    updateWatchlistItemNote: updateWatchlistItemNoteMutation.mutateAsync,
    reorderWatchlistItems: reorderWatchlistItemsMutation.mutateAsync,
    saveScreener: saveScreenerMutation.mutateAsync,
    updateScreener: updateScreenerMutation.mutateAsync,
    deleteScreener: deleteScreenerMutation.mutateAsync,
  };
}
