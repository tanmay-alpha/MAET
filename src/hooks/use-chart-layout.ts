/**
 * useChartLayout - Persist chart layouts to localStorage
 *
 * Saves and restores user's chart preferences including:
 * - Selected timeframe
 * - Chart type
 * - Visible indicators
 * - Drawing tool settings
 * - Named layouts (save/load)
 */

import { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import type { ChartState } from "@/components/trading/candlestick-chart";

const ChartTypeSchema = z.enum(["candles", "line", "area"]);

const IndicatorsSchema = z.object({
  volume: z.boolean(),
  ma: z.boolean(),
  rsi: z.boolean(),
  macd: z.boolean(),
});

const ChartLayoutSchema = z.object({
  timeframe: z.string(),
  chartType: ChartTypeSchema,
  indicators: IndicatorsSchema,
  drawingTool: z.string().nullable(),
});

export type ChartLayout = z.infer<typeof ChartLayoutSchema>;

const ChartStateSchema = z.object({
  zoom: z.number(),
  panOffset: z.number(),
  drawings: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["trendline", "horizontal", "vertical", "fibonacci", "support-resistance"]),
      points: z.array(z.object({ x: z.number(), y: z.number(), price: z.number(), time: z.number() })),
      color: z.string(),
      visible: z.boolean(),
    })
  ),
}) satisfies z.ZodType<ChartState>;

const SavedLayoutSchema = z.object({
  name: z.string(),
  chartState: ChartStateSchema.optional(),
  timeframe: z.string(),
  chartType: ChartTypeSchema,
  indicators: IndicatorsSchema,
  savedAt: z.string(),
});

export type SavedLayout = z.infer<typeof SavedLayoutSchema>;

// The chart page used to write its own shape under the named-layouts key; keep those
// entries loadable.
const LegacySavedLayoutSchema = z.object({
  chartState: ChartStateSchema.optional(),
  selectedTF: z.string(),
  selectedChartType: ChartTypeSchema,
  indicators: IndicatorsSchema.extend({ macd: z.boolean().optional() }),
});

const DEFAULT_LAYOUT: ChartLayout = {
  timeframe: "5m",
  chartType: "candles",
  indicators: {
    volume: true,
    ma: false,
    rsi: false,
    macd: false,
  },
  drawingTool: null,
};

function getStorageKey(symbol: string): string {
  return `maet_chart_layout_${symbol}`;
}

function getNamedLayoutsKey(symbol: string): string {
  return `maet_chart_layouts_${symbol}`;
}

/** Validates stored named layouts, upgrading legacy entries and dropping unreadable ones. */
export function parseNamedLayouts(raw: unknown): Record<string, SavedLayout> {
  if (raw === null || typeof raw !== "object") return {};
  const layouts: Record<string, SavedLayout> = {};
  for (const [name, value] of Object.entries(raw)) {
    const current = SavedLayoutSchema.safeParse(value);
    if (current.success) {
      layouts[name] = current.data;
      continue;
    }
    const legacy = LegacySavedLayoutSchema.safeParse(value);
    if (legacy.success) {
      const { chartState, selectedTF, selectedChartType, indicators } = legacy.data;
      layouts[name] = {
        name,
        chartState,
        timeframe: selectedTF,
        chartType: selectedChartType,
        indicators: { ...indicators, macd: indicators.macd ?? false },
        savedAt: new Date(0).toISOString(),
      };
    }
  }
  return layouts;
}

export function readStoredNamedLayouts(storage: Storage, symbol: string): Record<string, SavedLayout> {
  try {
    return parseNamedLayouts(JSON.parse(storage.getItem(getNamedLayoutsKey(symbol)) ?? "null"));
  } catch {
    return {};
  }
}

// Named layouts are shared by every tab, so each change is a read-modify-write of the
// stored map rather than a write of this tab's in-memory copy.
function writeStoredNamedLayouts(storage: Storage, symbol: string, layouts: Record<string, SavedLayout>) {
  if (Object.keys(layouts).length > 0) storage.setItem(getNamedLayoutsKey(symbol), JSON.stringify(layouts));
  else storage.removeItem(getNamedLayoutsKey(symbol));
}

/** Adds or replaces one named layout and returns the stored map. */
export function saveStoredNamedLayout(storage: Storage, symbol: string, layout: SavedLayout): Record<string, SavedLayout> {
  const layouts = { ...readStoredNamedLayouts(storage, symbol), [layout.name]: layout };
  writeStoredNamedLayouts(storage, symbol, layouts);
  return layouts;
}

/** Removes one named layout and returns the stored map. */
export function deleteStoredNamedLayout(storage: Storage, symbol: string, name: string): Record<string, SavedLayout> {
  const layouts = readStoredNamedLayouts(storage, symbol);
  delete layouts[name];
  writeStoredNamedLayouts(storage, symbol, layouts);
  return layouts;
}

function readStoredLayout(storage: Storage, symbol: string): ChartLayout {
  try {
    const stored = ChartLayoutSchema.partial().safeParse(JSON.parse(storage.getItem(getStorageKey(symbol)) ?? "null"));
    return stored.success ? { ...DEFAULT_LAYOUT, ...stored.data } : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function writeStoredLayout(storage: Storage, symbol: string, layout: ChartLayout) {
  storage.setItem(getStorageKey(symbol), JSON.stringify(layout));
}

export function useChartLayout(symbol: string) {
  // `symbol` is null until stored layouts are read after mount: server render and first
  // client render both show the defaults so hydration markup matches, and nothing is
  // persisted before the stored layout has been loaded.
  const [state, setState] = useState<{ symbol: string | null; layout: ChartLayout }>({
    symbol: null,
    layout: DEFAULT_LAYOUT,
  });
  const [named, setNamed] = useState<Record<string, SavedLayout>>({});
  const { layout } = state;

  useEffect(() => {
    setState({ symbol, layout: readStoredLayout(localStorage, symbol) });
    setNamed(readStoredNamedLayouts(localStorage, symbol));

    // Pick up layouts saved or deleted in other tabs.
    const namedKey = getNamedLayoutsKey(symbol);
    const onStorage = (event: StorageEvent) => {
      if (event.key === namedKey || event.key === null) setNamed(readStoredNamedLayouts(localStorage, symbol));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [symbol]);

  useEffect(() => {
    if (state.symbol === null) return;
    try {
      writeStoredLayout(localStorage, state.symbol, state.layout);
    } catch {
      // Storage full or disabled: the layout still works for this session.
    }
  }, [state]);

  const updateLayout = useCallback((updates: Partial<ChartLayout>) => {
    setState((prev) => ({ ...prev, layout: { ...prev.layout, ...updates } }));
  }, []);

  const updateIndicator = useCallback((key: keyof ChartLayout["indicators"], value: boolean) => {
    setState((prev) => ({
      ...prev,
      layout: { ...prev.layout, indicators: { ...prev.layout.indicators, [key]: value } },
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setState((prev) => ({ ...prev, layout: DEFAULT_LAYOUT }));
  }, []);

  // Named layouts management
  const saveNamedLayout = useCallback((name: string, chartState: ChartState) => {
    try {
      setNamed(saveStoredNamedLayout(localStorage, symbol, {
        name,
        chartState,
        timeframe: layout.timeframe,
        chartType: layout.chartType,
        indicators: { ...layout.indicators },
        savedAt: new Date().toISOString(),
      }));
      return true;
    } catch {
      return false;
    }
  }, [symbol, layout]);

  /** Applies the named layout's settings and returns it (for its chart state), or null if absent. */
  const loadNamedLayout = useCallback((name: string): SavedLayout | null => {
    const saved = named[name];
    if (!saved) return null;
    updateLayout({ timeframe: saved.timeframe, chartType: saved.chartType, indicators: saved.indicators });
    return saved;
  }, [named, updateLayout]);

  const deleteNamedLayout = useCallback((name: string) => {
    try {
      setNamed(deleteStoredNamedLayout(localStorage, symbol, name));
    } catch {
      // Storage disabled: nothing was persisted to delete.
    }
  }, [symbol]);

  // Export layout to JSON file
  const exportLayout = useCallback((chartState?: ChartState) => {
    const data = {
      version: 1,
      layout,
      chartState,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maet-layout-${symbol}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [symbol, layout]);

  /** Applies an exported layout file; resolves false if it isn't a valid layout export. */
  const importLayout = useCallback(async (file: File): Promise<boolean> => {
    try {
      const parsed = z.object({ layout: ChartLayoutSchema }).safeParse(JSON.parse(await file.text()));
      if (!parsed.success) return false;
      updateLayout(parsed.data.layout);
      return true;
    } catch {
      return false;
    }
  }, [updateLayout]);

  return {
    layout,
    updateLayout,
    updateIndicator,
    resetLayout,
    namedLayoutNames: Object.keys(named),
    saveNamedLayout,
    loadNamedLayout,
    deleteNamedLayout,
    exportLayout,
    importLayout,
  };
}

// Hook for keyboard shortcuts
export function useChartShortcuts(handlers: {
  onToggleFullscreen?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onPanLeft?: () => void;
  onPanRight?: () => void;
  onSelectTool?: (tool: string) => void;
  onToggleVolume?: () => void;
  onToggleMA?: () => void;
  onToggleRSI?: () => void;
  onDeleteDrawing?: () => void;
  onEscape?: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        // Fullscreen
        case "f11":
          e.preventDefault();
          handlers.onToggleFullscreen?.();
          break;

        // Zoom
        case "+":
        case "=":
          e.preventDefault();
          handlers.onZoomIn?.();
          break;
        case "-":
        case "_":
          e.preventDefault();
          handlers.onZoomOut?.();
          break;
        case "0":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handlers.onResetZoom?.();
          }
          break;

        // Pan
        case "arrowleft":
          if (!e.altKey) {
            e.preventDefault();
            handlers.onPanLeft?.();
          }
          break;
        case "arrowright":
          if (!e.altKey) {
            e.preventDefault();
            handlers.onPanRight?.();
          }
          break;

        // Drawing tools
        case "t":
          e.preventDefault();
          handlers.onSelectTool?.("trend");
          break;
        case "h":
          e.preventDefault();
          handlers.onSelectTool?.("horizontal");
          break;
        case "v":
          e.preventDefault();
          handlers.onSelectTool?.("vertical");
          break;
        case "f":
          e.preventDefault();
          handlers.onSelectTool?.("fibonacci");
          break;
        case "s":
          e.preventDefault();
          handlers.onSelectTool?.("support");
          break;

        // Indicators
        case "m":
          if (!e.altKey) {
            e.preventDefault();
            handlers.onToggleMA?.();
          }
          break;
        case "r":
          if (!e.altKey) {
            e.preventDefault();
            handlers.onToggleRSI?.();
          }
          break;

        // Delete last drawing
        case "delete":
        case "backspace":
          if (!(e.target instanceof HTMLInputElement)) {
            e.preventDefault();
            handlers.onDeleteDrawing?.();
          }
          break;

        // Escape to exit tool
        case "escape":
          e.preventDefault();
          handlers.onEscape?.();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}

// Fullscreen toggle hook
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const toggleFullscreen = useCallback(async (element?: HTMLElement) => {
    try {
      if (!document.fullscreenElement) {
        await (element || document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen may not be supported
    }
  }, []);

  return { isFullscreen, toggleFullscreen };
}

// Export DrawingLine type for external use
export type { DrawingLine } from "@/components/trading/candlestick-chart";
export type { ChartState } from "@/components/trading/candlestick-chart";