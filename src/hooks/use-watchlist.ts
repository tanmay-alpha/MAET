import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { WATCHLIST, type MarketCatalogItem } from "@/lib/market-catalog";

const LOCAL_STORAGE_KEY = "maet_guest_watchlist_v1";

export function useWatchlist() {
  const queryClient = useQueryClient();

  const [localItems, setLocalItems] = useState<MarketCatalogItem[]>(() => {
    if (typeof window === "undefined") return WATCHLIST;
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      return saved ? JSON.parse(saved) : WATCHLIST;
    } catch {
      return WATCHLIST;
    }
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localItems));
      } catch (err) {
        console.warn("Failed to persist guest watchlist locally:", err);
      }
    }
  }, [localItems]);

  const watchlistsQuery = useQuery({
    queryKey: ["workspace", "listWatchlists"],
    queryFn: async () => {
      try {
        return await trpc.workspace.listWatchlists.query();
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 10000,
  });

  const isAuthenticated = Boolean(watchlistsQuery.data && watchlistsQuery.data.items);

  const addItemMutation = useMutation({
    mutationFn: async ({ symbol, name, exchange = "NSE" }: { symbol: string; name?: string; exchange?: "NSE" | "BSE" }) => {
      const upperSymbol = symbol.toUpperCase();
      if (isAuthenticated && watchlistsQuery.data?.items[0]?.id) {
        await trpc.workspace.addWatchlistItem.mutate({
          watchlistId: watchlistsQuery.data.items[0].id,
          symbol: upperSymbol,
          exchange,
        });
      } else {
        setLocalItems((prev) => {
          if (prev.some((item) => item.symbol === upperSymbol)) return prev;
          return [{ symbol: upperSymbol, name: name || upperSymbol, exchange }, ...prev];
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const upperSymbol = symbol.toUpperCase();
      if (isAuthenticated) {
        // Find item ID
      }
      setLocalItems((prev) => prev.filter((item) => item.symbol !== upperSymbol));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const items: MarketCatalogItem[] = useMemo(() => {
    return localItems;
  }, [localItems]);

  return {
    items,
    isAuthenticated,
    isSavedLocally: !isAuthenticated,
    addItem: addItemMutation.mutateAsync,
    removeItem: removeItemMutation.mutateAsync,
  };
}
