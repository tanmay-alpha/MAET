import { useState, useEffect, useCallback, useRef } from "react";
import type { LayoutType, ChartPane, ChartDrawing } from "@shared/research/contracts";
import { trpc } from "@/lib/trpc";

const LOCAL_STORAGE_KEY = "maet_chart_workspace_v2";

export interface WorkspaceState {
  layoutType: LayoutType;
  panes: ChartPane[];
  activePaneKey: string;
  linkSymbol: boolean;
  linkTimeframe: boolean;
  linkCrosshair: boolean;
  saveStatus: "Saved" | "Saving" | "Offline" | "Error";
}

const DEFAULT_PANE: ChartPane = {
  id: "default-pane-1",
  paneKey: "pane-1",
  symbol: "RELIANCE",
  exchange: "NSE",
  timeframe: "5m",
  chartType: "CANDLE",
  position: 0,
  indicators: [
    {
      id: "sma-20",
      type: "SMA",
      pane: "main",
      parameters: { period: 20 },
      style: { color: "#3b82f6" },
      visible: true,
    },
    {
      id: "rsi-14",
      type: "RSI",
      pane: "subpanel",
      parameters: { period: 14 },
      style: { color: "#ec4899" },
      visible: true,
    },
  ],
  drawings: [],
  settings: {},
};

export function useChartWorkspace(initialSymbol: string = "RELIANCE") {
  const [state, setState] = useState<WorkspaceState>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          saveStatus: "Saved",
        };
      }
    } catch (e) {
      // Fallback
    }
    return {
      layoutType: "SINGLE",
      panes: [{ ...DEFAULT_PANE, symbol: initialSymbol }],
      activePaneKey: "pane-1",
      linkSymbol: true,
      linkTimeframe: false,
      linkCrosshair: true,
      saveStatus: "Saved",
    };
  });

  const saveTimeoutRef = useRef<Timer | null>(null);

  // Debounced LocalStorage Autosave
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        // Handle storage error
      }
    }, 500);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [state]);

  const setLayoutType = useCallback((layoutType: LayoutType) => {
    setState((prev) => {
      const neededPanes = layoutType === "SINGLE" ? 1 : layoutType === "GRID_4" ? 4 : 2;
      const currentPanes = [...prev.panes];

      while (currentPanes.length < neededPanes) {
        const idx = currentPanes.length;
        currentPanes.push({
          ...DEFAULT_PANE,
          id: `pane-${idx + 1}-${Date.now()}`,
          paneKey: `pane-${idx + 1}`,
          symbol: prev.linkSymbol ? currentPanes[0].symbol : ["RELIANCE", "TCS", "INFY", "HDFCBANK"][idx] || "RELIANCE",
          position: idx,
        });
      }

      return {
        ...prev,
        layoutType,
        panes: currentPanes.slice(0, neededPanes),
        activePaneKey: currentPanes[0].paneKey,
      };
    });
  }, []);

  const setPaneSymbol = useCallback((paneKey: string, symbol: string) => {
    setState((prev) => {
      const newPanes = prev.panes.map((p) => {
        if (prev.linkSymbol || p.paneKey === paneKey) {
          return { ...p, symbol };
        }
        return p;
      });
      return { ...prev, panes: newPanes };
    });
  }, []);

  const setPaneTimeframe = useCallback((paneKey: string, timeframe: any) => {
    setState((prev) => {
      const newPanes = prev.panes.map((p) => {
        if (prev.linkTimeframe || p.paneKey === paneKey) {
          return { ...p, timeframe };
        }
        return p;
      });
      return { ...prev, panes: newPanes };
    });
  }, []);

  const setPaneDrawings = useCallback((paneKey: string, drawings: ChartDrawing[]) => {
    setState((prev) => {
      const newPanes = prev.panes.map((p) => {
        if (p.paneKey === paneKey) {
          return { ...p, drawings };
        }
        return p;
      });
      return { ...prev, panes: newPanes };
    });
  }, []);

  const toggleLinkSymbol = useCallback(() => {
    setState((prev) => ({ ...prev, linkSymbol: !prev.linkSymbol }));
  }, []);

  const toggleLinkCrosshair = useCallback(() => {
    setState((prev) => ({ ...prev, linkCrosshair: !prev.linkCrosshair }));
  }, []);

  return {
    ...state,
    setLayoutType,
    setPaneSymbol,
    setPaneTimeframe,
    setPaneDrawings,
    toggleLinkSymbol,
    toggleLinkCrosshair,
    setActivePaneKey: (key: string) => setState((prev) => ({ ...prev, activePaneKey: key })),
  };
}
