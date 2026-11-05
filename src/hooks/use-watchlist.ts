import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { WATCHLIST, type MarketCatalogItem } from "@/lib/market-catalog";

const LOCAL_STORAGE_KEY = "maet_guest_watchlist_v1";

export function useWatchlist() {
  const queryClient = useQueryClient();

  // Start from the default list on both server and first client render; the saved guest
  // list is restored after mount so hydration markup matches.
  const [localItems, setLocalItems] = useState<MarketCatalogItem[]>(WATCHLIST);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) setLocalItems(JSON.parse(saved));
    } catch {
      // Corrupt entry: keep the default list; the next change overwrites it.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localItems));
    } catch (err) {
      console.warn("Failed to persist guest watchlist locally:", err);
    }
  }, [hydrated, localItems]);

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
