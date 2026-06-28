/**
 * useChartLayout - Persist chart layouts to localStorage
 *
 * Saves and restores user's chart preferences including:
 * - Selected timeframe
 * - Chart type
 * - Visible indicators
 * - Drawing tool settings
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

  return {
    layout,
    updateLayout,
    updateIndicator,
    resetLayout,
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
          e.preventDefault();
          handlers.onPanLeft?.();
          break;
        case "arrowright":
          e.preventDefault();
          handlers.onPanRight?.();
          break;

        // Drawing tools
        case "t":
          e.preventDefault();
          handlers.onSelectTool?.("trend");
          break;
        case "h":
          e.preventDefault();
          handlers.onSelectTool?.("hline");
          break;
        case "v":
          e.preventDefault();
          handlers.onSelectTool?.("vline");
          break;
        case "f":
          e.preventDefault();
          handlers.onSelectTool?.("fib");
          break;

        // Escape to exit tool
        case "escape":
          e.preventDefault();
          handlers.onSelectTool?.(null as any);
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