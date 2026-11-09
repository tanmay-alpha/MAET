import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc, type WorkspaceWatchlist } from "@/lib/trpc";
import { useSignedIn } from "@/hooks/use-signed-in";
import { WATCHLIST, type MarketCatalogItem } from "@/lib/market-catalog";

const LOCAL_STORAGE_KEY = "maet_guest_watchlist_v1";
const DEFAULT_SERVER_WATCHLIST_NAME = "My watchlist";
const CATALOG_NAMES = new Map(WATCHLIST.map((item) => [item.symbol, item.name]));

/** The signed-in list's symbols in server order, one row per symbol (NSE and BSE rows collapse). */
export function serverWatchlistItems(watchlist: WorkspaceWatchlist | undefined): MarketCatalogItem[] {
  if (!watchlist) return [];
  const seen = new Set<string>();
  const items: MarketCatalogItem[] = [];
  for (const item of watchlist.items) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    items.push({ symbol: item.symbol, name: CATALOG_NAMES.get(item.symbol) ?? item.symbol });
  }
  return items;
}

/** Server item ids to delete when the user removes `symbol` (every exchange row for it). */
export function serverWatchlistItemIds(watchlist: WorkspaceWatchlist | undefined, symbol: string): string[] {
  const upperSymbol = symbol.toUpperCase();
  return (watchlist?.items ?? []).filter((item) => item.symbol === upperSymbol).map((item) => item.id);
}

export function useWatchlist() {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();

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
    // Logged-out visitors use the guest list stored in this browser.
    enabled: signedIn,
    retry: false,
    staleTime: 10000,
  });

  const isAuthenticated = signedIn && Boolean(watchlistsQuery.data && watchlistsQuery.data.items);
  // The hook edits the account's first (default) list, in the server's list order.
  const serverWatchlist = isAuthenticated ? watchlistsQuery.data?.items[0] : undefined;

  const addItemMutation = useMutation({
    mutationFn: async ({ symbol, name, exchange = "NSE" }: { symbol: string; name?: string; exchange?: "NSE" | "BSE" }) => {
      const upperSymbol = symbol.toUpperCase();
      if (isAuthenticated) {
        const watchlistId = serverWatchlist?.id
          ?? (await trpc.workspace.createWatchlist.mutate({ name: DEFAULT_SERVER_WATCHLIST_NAME })).id;
        await trpc.workspace.addWatchlistItem.mutate({ watchlistId, symbol: upperSymbol, exchange });
      } else {
        setLocalItems((prev) => {
          if (prev.some((item) => item.symbol === upperSymbol)) return prev;
          return [{ symbol: upperSymbol, name: name || upperSymbol, exchange }, ...prev];
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  });

  const removeItemMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const upperSymbol = symbol.toUpperCase();
      if (isAuthenticated) {
        await Promise.all(
          serverWatchlistItemIds(serverWatchlist, upperSymbol)
            .map((itemId) => trpc.workspace.removeWatchlistItem.mutate({ itemId })),
        );
      } else {
        setLocalItems((prev) => prev.filter((item) => item.symbol !== upperSymbol));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  });

  // Signed in: the account list (nothing until it loads, so the guest list never flashes);
  // signed out, or when the account list cannot be loaded: the list kept in this browser.
  const awaitingServerList = signedIn && watchlistsQuery.isPending;
  const items: MarketCatalogItem[] = useMemo(() => {
    if (isAuthenticated) return serverWatchlistItems(serverWatchlist);
    return awaitingServerList ? [] : localItems;
  }, [isAuthenticated, serverWatchlist, awaitingServerList, localItems]);

  return {
    items,
    isAuthenticated,
    isSavedLocally: !isAuthenticated,
    addItem: addItemMutation.mutateAsync,
    removeItem: removeItemMutation.mutateAsync,
  };
}
