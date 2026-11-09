import { describe, expect, it } from "bun:test";
import type { WorkspaceWatchlist, WorkspaceWatchlistItem } from "@/lib/trpc";
import { serverWatchlistItemIds, serverWatchlistItems } from "./use-watchlist";

function item(id: string, symbol: string, exchange: "NSE" | "BSE" = "NSE"): WorkspaceWatchlistItem {
  return { id, symbol, exchange, note: null, position: 0, createdAt: "2026-11-01T00:00:00.000Z" } as WorkspaceWatchlistItem;
}

function watchlist(items: WorkspaceWatchlistItem[]): WorkspaceWatchlist {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "My watchlist",
    description: null,
    isPinned: false,
    position: 0,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    items,
  } as WorkspaceWatchlist;
}

describe("signed-in watchlist", () => {
  it("shows the account list's symbols in server order, one row per symbol", () => {
    const list = watchlist([item("a", "TCS"), item("b", "ZOMATO"), item("c", "TCS", "BSE")]);
    expect(serverWatchlistItems(list)).toEqual([
      { symbol: "TCS", name: "Tata Consultancy Services" },
      { symbol: "ZOMATO", name: "ZOMATO" },
    ]);
  });

  it("shows nothing for an account without a list", () => {
    expect(serverWatchlistItems(undefined)).toEqual([]);
  });

  it("removes every exchange row of the symbol by its server item id", () => {
    const list = watchlist([item("a", "TCS"), item("b", "INFY"), item("c", "TCS", "BSE")]);
    expect(serverWatchlistItemIds(list, "tcs")).toEqual(["a", "c"]);
    expect(serverWatchlistItemIds(list, "RELIANCE")).toEqual([]);
    expect(serverWatchlistItemIds(undefined, "TCS")).toEqual([]);
  });
});
