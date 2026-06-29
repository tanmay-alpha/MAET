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

export interface ChartLayout {
  timeframe: string;
  chartType: "candles" | "line" | "area";
  indicators: {
    volume: boolean;
    ma: boolean;
    rsi: boolean;
    macd: boolean;
  };
  drawingTool: string | null;
}

export interface SavedLayout {
  name: string;
  chartState?: {
    zoom: number;
    panOffset: number;
    drawings: unknown[];
  };
  timeframe: string;
  chartType: "candles" | "line" | "area";
  indicators: ChartLayout["indicators"];
  savedAt: string;
}

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

export function useChartLayout(symbol: string) {
  const [layout, setLayout] = useState<ChartLayout>(() => {
    // Load from localStorage on init
    if (typeof window === "undefined") return DEFAULT_LAYOUT;

    try {
      const stored = localStorage.getItem(getStorageKey(symbol));
      if (stored) {
        return { ...DEFAULT_LAYOUT, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_LAYOUT;
  });

  // Persist to localStorage on change
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(getStorageKey(symbol), JSON.stringify(layout));
    } catch {
      // Ignore storage errors
    }
  }, [symbol, layout]);

  const updateLayout = useCallback((updates: Partial<ChartLayout>) => {
    setLayout((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateIndicator = useCallback((key: keyof ChartLayout["indicators"], value: boolean) => {
    setLayout((prev) => ({
      ...prev,
      indicators: { ...prev.indicators, [key]: value },
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
  }, []);

  // Named layouts management
  const saveNamedLayout = useCallback((name: string, chartState?: ChartLayout) => {
    if (typeof window === "undefined") return false;
    try {
      const layouts = getNamedLayouts(symbol);
      const newLayout: SavedLayout = {
        name,
        chartState: chartState as SavedLayout["chartState"],
        timeframe: layout.timeframe,
        chartType: layout.chartType,
        indicators: { ...layout.indicators },
        savedAt: new Date().toISOString(),
      };
      layouts[name] = newLayout;
      localStorage.setItem(getNamedLayoutsKey(symbol), JSON.stringify(layouts));
      return true;
    } catch {
      return false;
    }
  }, [symbol, layout]);

  const loadNamedLayout = useCallback((name: string): SavedLayout | null => {
    if (typeof window === "undefined") return null;
    try {
      const layouts = getNamedLayouts(symbol);
      return layouts[name] || null;
    } catch {
      return null;
    }
  }, [symbol]);

  const deleteNamedLayout = useCallback((name: string) => {
    if (typeof window === "undefined") return;
    try {
      const layouts = getNamedLayouts(symbol);
      delete layouts[name];
      localStorage.setItem(getNamedLayoutsKey(symbol), JSON.stringify(layouts));
    } catch {
      // Ignore
    }
  }, [symbol]);

  const getNamedLayoutNames = useCallback((): string[] => {
    if (typeof window === "undefined") return [];
    try {
      return Object.keys(getNamedLayouts(symbol));
    } catch {
      return [];
    }
  }, [symbol]);

  // Export layout to JSON file
  const exportLayout = useCallback((chartState?: unknown) => {
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

  // Import layout from JSON file
  const importLayout = useCallback((file: File): Promise<SavedLayout | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.layout) {
            setLayout(data.layout);
            resolve(data);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  return {
    layout,
    updateLayout,
    updateIndicator,
    resetLayout,
    saveNamedLayout,
    loadNamedLayout,
    deleteNamedLayout,
    getNamedLayoutNames,
    exportLayout,
    importLayout,
  };
}

function getNamedLayouts(symbol: string): Record<string, SavedLayout> {
  try {
    const stored = localStorage.getItem(getNamedLayoutsKey(symbol));
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
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