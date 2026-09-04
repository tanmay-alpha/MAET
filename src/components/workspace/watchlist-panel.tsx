import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";
import type { WorkspaceExchange, WorkspaceWatchlistItem } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The workspace request failed";
}

function formatPrice(price: number): string {
  return `₹${price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatChange(changePct: number): string {
  return `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

export function WatchlistPanel() {
  const {
    watchlists,
    isLoading,
    createWatchlist,
    renameWatchlist,
    deleteWatchlist,
    addWatchlistItem,
    removeWatchlistItem,
    updateWatchlistItemNote,
    reorderWatchlistItems,
  } = useResearchWorkspace();
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState<WorkspaceExchange>("NSE");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (watchlists.length === 0) {
      setSelectedWatchlistId(null);
      return;
    }
    if (!selectedWatchlistId || !watchlists.some((watchlist) => watchlist.id === selectedWatchlistId)) {
      setSelectedWatchlistId(watchlists[0].id);
    }
  }, [selectedWatchlistId, watchlists]);

  const selectedWatchlist = useMemo(
    () => watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? watchlists[0],
    [selectedWatchlistId, watchlists],
  );
  const symbols = useMemo(
    () => selectedWatchlist?.items.map((item) => item.symbol) ?? [],
    [selectedWatchlist],
  );
  const { quoteMap } = useMarketQuotes(symbols);

  const runAction = async (name: string, operation: () => Promise<unknown>) => {
    setPendingAction(name);
    setErrorMessage(null);
    try {
      await operation();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = newWatchlistName.trim();
    if (!name) return;
    await runAction("create", async () => {
      await createWatchlist(name);
      setNewWatchlistName("");
    });
  };

  const handleRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWatchlist) return;
    const name = renameDraft.trim();
    if (!name) return;
    await runAction("rename", async () => {
      await renameWatchlist({ watchlistId: selectedWatchlist.id, name });
      setIsRenaming(false);
      setRenameDraft("");
    });
  };

  const handleDelete = async () => {
    if (!selectedWatchlist) return;
    const nextWatchlist = watchlists.find((watchlist) => watchlist.id !== selectedWatchlist.id);
    await runAction("delete", async () => {
      await deleteWatchlist(selectedWatchlist.id);
      setSelectedWatchlistId(nextWatchlist?.id ?? null);
      setDeleteConfirmationId(null);
    });
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWatchlist) return;
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) return;
    await runAction("add", async () => {
      await addWatchlistItem({
        watchlistId: selectedWatchlist.id,
        symbol: normalizedSymbol,
        exchange,
      });
      setSymbol("");
    });
  };

  const handleSaveNote = async (item: WorkspaceWatchlistItem) => {
    await runAction(`note:${item.id}`, async () => {
      await updateWatchlistItemNote({ itemId: item.id, note: noteDraft });
      setEditingNoteId(null);
      setNoteDraft("");
    });
  };

  const handleMove = async (itemIndex: number, direction: -1 | 1) => {
    if (!selectedWatchlist) return;
    const targetIndex = itemIndex + direction;
    if (targetIndex < 0 || targetIndex >= selectedWatchlist.items.length) return;
    const reordered = [...selectedWatchlist.items];
    [reordered[itemIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[itemIndex]];
    await runAction("reorder", () => reorderWatchlistItems(
      reordered.map((item, position) => ({ itemId: item.id, position })),
    ));
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/20 p-4">
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="New watchlist name"
            value={newWatchlistName}
            onChange={(event) => setNewWatchlistName(event.target.value)}
            placeholder="New watchlist name"
            maxLength={80}
          />
          <Button type="submit" disabled={!newWatchlistName.trim() || pendingAction !== null}>
            <Plus />
            Create watchlist
          </Button>
        </form>
      </div>

      {errorMessage && (
        <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Loading account workspace…</div>
      ) : watchlists.length === 0 ? (
        <div className="p-10 text-center">
          <h2 className="font-semibold">No watchlists yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create a named list to organise the instruments you research.</p>
        </div>
      ) : selectedWatchlist ? (
        <>
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={selectedWatchlist.id} onValueChange={setSelectedWatchlistId}>
                <SelectTrigger className="w-full sm:w-72" aria-label="Select watchlist">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {watchlists.map((watchlist) => (
                    <SelectItem key={watchlist.id} value={watchlist.id}>
                      {watchlist.name} · {watchlist.items.length}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {selectedWatchlist.items.length} instrument{selectedWatchlist.items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isRenaming ? (
                <form onSubmit={handleRename} className="flex items-center gap-2">
                  <Input
                    aria-label="Rename watchlist"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    maxLength={80}
                    className="h-8 w-48"
                    autoFocus
                  />
                  <Button type="submit" size="icon" variant="outline" disabled={!renameDraft.trim() || pendingAction !== null} aria-label="Save watchlist name">
                    <Check />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => setIsRenaming(false)} aria-label="Cancel rename">
                    <X />
                  </Button>
                </form>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRenameDraft(selectedWatchlist.name);
                    setIsRenaming(true);
                    setDeleteConfirmationId(null);
                  }}
                >
                  <Pencil />
                  Rename
                </Button>
              )}

              {deleteConfirmationId === selectedWatchlist.id ? (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1">
                  <span className="text-xs text-destructive">Delete this list?</span>
                  <Button type="button" size="sm" variant="destructive" onClick={handleDelete} disabled={pendingAction !== null}>
                    Confirm
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteConfirmationId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteConfirmationId(selectedWatchlist.id);
                    setIsRenaming(false);
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              )}
            </div>
          </div>

          <form onSubmit={handleAdd} className="grid gap-2 border-b border-border p-4 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <Input
              aria-label="Symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="Symbol, e.g. RELIANCE"
              maxLength={20}
            />
            <Select value={exchange} onValueChange={(value) => setExchange(value as WorkspaceExchange)}>
              <SelectTrigger aria-label="Exchange">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NSE">NSE</SelectItem>
                <SelectItem value="BSE">BSE</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!symbol.trim() || pendingAction !== null}>
              <Plus />
              Add symbol
            </Button>
          </form>

          {selectedWatchlist.items.length === 0 ? (
            <div className="p-10 text-center">
              <h2 className="font-semibold">This watchlist is empty</h2>
              <p className="mt-1 text-sm text-muted-foreground">Add a symbol above to start tracking it here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Change %</TableHead>
                  <TableHead className="min-w-64">Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedWatchlist.items.map((item, itemIndex) => {
                  const candidateQuote = quoteMap.get(item.symbol);
                  const quote = candidateQuote?.exchange === item.exchange ? candidateQuote : undefined;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono font-semibold">{item.symbol}</TableCell>
                      <TableCell className="text-muted-foreground">{item.exchange}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {quote ? formatPrice(quote.price) : "—"}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums ${
                        quote?.changePct === undefined ? "text-muted-foreground" : quote.changePct >= 0 ? "text-bull" : "text-bear"
                      }`}>
                        {quote?.changePct === undefined ? "—" : formatChange(quote.changePct)}
                      </TableCell>
                      <TableCell>
                        {editingNoteId === item.id ? (
                          <div className="flex min-w-64 items-center gap-2">
                            <Input
                              aria-label={`Note for ${item.symbol}`}
                              value={noteDraft}
                              onChange={(event) => setNoteDraft(event.target.value)}
                              placeholder="Add a research note"
                              maxLength={512}
                              className="h-8"
                              autoFocus
                            />
                            <Button type="button" size="icon" variant="outline" onClick={() => handleSaveNote(item)} disabled={pendingAction !== null} aria-label={`Save note for ${item.symbol}`}>
                              <Save />
                            </Button>
                            <Button type="button" size="icon" variant="ghost" onClick={() => setEditingNoteId(null)} aria-label={`Cancel note for ${item.symbol}`}>
                              <X />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNoteId(item.id);
                              setNoteDraft(item.note ?? "");
                            }}
                            className="max-w-80 truncate text-left text-sm text-muted-foreground hover:text-foreground"
                            title={item.note ?? "Add note"}
                          >
                            {item.note || "Add note"}
                          </button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="icon" variant="ghost" onClick={() => handleMove(itemIndex, -1)} disabled={itemIndex === 0 || pendingAction !== null} aria-label={`Move ${item.symbol} up`}>
                            <ChevronUp />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" onClick={() => handleMove(itemIndex, 1)} disabled={itemIndex === selectedWatchlist.items.length - 1 || pendingAction !== null} aria-label={`Move ${item.symbol} down`}>
                            <ChevronDown />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => runAction(`remove:${item.id}`, () => removeWatchlistItem(item.id))}
                            disabled={pendingAction !== null}
                            aria-label={`Remove ${item.symbol}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      ) : null}
    </section>
  );
}
