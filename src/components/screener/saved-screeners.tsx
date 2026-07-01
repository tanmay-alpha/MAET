import { useEffect, useState, useCallback } from "react";
import { Bookmark, BookmarkPlus, Trash2, Edit2, X, Check } from "lucide-react";
import { ContractPanel } from "@/components/common/contract-panel";

export type SavedScreener = {
  id: string;
  name: string;
  filters: FilterCondition[];
  createdAt: string;
  updatedAt: string;
};

export type FilterCondition = {
  field: string;
  operator: "gt" | "lt" | "eq" | "gte" | "lte" | "between" | "contains";
  value: string | number;
  value2?: string | number; // for "between"
};

const STORAGE_KEY = "maet:saved-screeners";

function loadScreeners(): SavedScreener[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveScreeners(screeners: SavedScreener[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(screeners));
}

function generateId(): string {
  return crypto.randomUUID();
}

export const AVAILABLE_FIELDS = [
  { value: "price", label: "Price" },
  { value: "volume", label: "Volume" },
  { value: "changePct", label: "Change %" },
];

export const OPERATORS: { value: FilterCondition["operator"]; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "eq", label: "=" },
  { value: "contains", label: "contains" },
];

interface SavedScreenersProps {
  onApply?: (screener: SavedScreener) => void;
}

export function SavedScreeners({ onApply }: SavedScreenersProps) {
  const [screeners, setScreeners] = useState<SavedScreener[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formFilters, setFormFilters] = useState<FilterCondition[]>([
    { field: "volume", operator: "gt", value: 1000000 },
  ]);

  useEffect(() => {
    setScreeners(loadScreeners());
  }, []);

  const persist = useCallback((updated: SavedScreener[]) => {
    saveScreeners(updated);
    setScreeners(updated);
  }, []);

  function handleSave() {
    if (!formName.trim()) return;
    const now = new Date().toISOString();
    if (editingId) {
      const updated = screeners.map((s) =>
        s.id === editingId ? { ...s, name: formName.trim(), filters: formFilters, updatedAt: now } : s
      );
      persist(updated);
    } else {
      const screener: SavedScreener = {
        id: generateId(),
        name: formName.trim(),
        filters: formFilters,
        createdAt: now,
        updatedAt: now,
      };
      persist([...screeners, screener]);
    }
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormFilters([{ field: "volume", operator: "gt", value: 1000000 }]);
  }

  function handleEdit(screener: SavedScreener) {
    setFormName(screener.name);
    setFormFilters(screener.filters);
    setEditingId(screener.id);
    setShowForm(true);
  }

  function handleDelete(id: string) {
    persist(screeners.filter((s) => s.id !== id));
    setDeleteConfirmId(null);
  }

  function addFilter() {
    setFormFilters((prev) => [...prev, { field: "volume", operator: "gt", value: 1000000 }]);
  }

  function removeFilter(idx: number) {
    setFormFilters((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateFilter(idx: number, patch: Partial<FilterCondition>) {
    setFormFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  if (!showForm && screeners.length === 0) {
    return (
      <div className="space-y-2">
        <ContractPanel message="No saved screeners yet. Create one to quickly filter stocks." />
        <button
          onClick={() => setShowForm(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border bg-panel px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
          Create screener
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Saved Screeners</span>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
            setFormName("");
            setFormFilters([{ field: "volume", operator: "gt", value: 1000000 }]);
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent"
        >
          <BookmarkPlus className="h-3 w-3" />
          New
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-panel p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Screener name..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <button onClick={handleSave} className="rounded p-1 hover:bg-accent" aria-label="Save screener">
              <Check className="h-3.5 w-3.5 text-bull" />
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="rounded p-1 hover:bg-accent" aria-label="Cancel screener">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {formFilters.map((filter, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <select
                  value={filter.field}
                  onChange={(e) => updateFilter(idx, { field: e.target.value })}
                  className="rounded border border-border bg-background px-1.5 py-1 text-xs"
                >
                  {AVAILABLE_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={filter.operator}
                  onChange={(e) => updateFilter(idx, { operator: e.target.value as FilterCondition["operator"] })}
                  className="rounded border border-border bg-background px-1.5 py-1 text-xs"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
                <input
                  value={filter.value}
                  onChange={(e) => updateFilter(idx, { value: e.target.value })}
                  className="w-20 rounded border border-border bg-background px-1.5 py-1 text-xs font-mono"
                  type="number"
                />
                <button onClick={() => removeFilter(idx)} className="rounded p-1 hover:bg-accent">
                  <X className="h-3 w-3 text-bear" />
                </button>
              </div>
            ))}
          </div>
          <button onClick={addFilter} className="text-xs text-muted-foreground hover:text-primary">
            + Add filter
          </button>
        </div>
      )}

      {!showForm && screeners.length > 0 && (
        <div className="space-y-1">
          {screeners.map((screener) => (
            <div key={screener.id} className="group flex items-center justify-between rounded border border-border bg-panel px-3 py-2">
              <button
                onClick={() => onApply?.(screener)}
                className="flex flex-col gap-0.5 text-left"
              >
                <span className="text-xs font-medium">{screener.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {screener.filters.length} filter{screener.filters.length !== 1 ? "s" : ""} · {new Date(screener.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEdit(screener)} className="rounded p-1 hover:bg-accent">
                  <Edit2 className="h-3 w-3" />
                </button>
                {deleteConfirmId === screener.id ? (
                  <>
                    <button onClick={() => handleDelete(screener.id)} className="rounded p-1 hover:bg-accent text-bear">
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={() => setDeleteConfirmId(null)} className="rounded p-1 hover:bg-accent">
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <button onClick={() => setDeleteConfirmId(screener.id)} className="rounded p-1 hover:bg-accent">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
