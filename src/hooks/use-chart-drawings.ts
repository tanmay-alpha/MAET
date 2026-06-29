/**
 * useChartDrawings - Hook for managing chart drawing tools
 */

import { useState, useCallback, useEffect } from "react";
import {
  Drawing,
  DrawingState,
  Point,
  createDrawing,
  DRAWING_TOOLS,
} from "@/lib/drawing-tools";

const STORAGE_KEY = "maet-chart-drawings";

interface UseChartDrawingsOptions {
  symbol?: string;
  timeframe?: string;
}

export function useChartDrawings(options: UseChartDrawingsOptions = {}) {
  const { symbol = "default", timeframe = "1d" } = options;
  const storageKey = `${STORAGE_KEY}-${symbol}-${timeframe}`;

  const [state, setState] = useState<DrawingState>({
    activeTool: null,
    drawings: [],
    currentPoints: [],
  });

  // Load drawings from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const drawings = JSON.parse(saved) as Drawing[];
        setState((prev) => ({ ...prev, drawings }));
      }
    } catch {
      console.warn("Failed to load drawings from localStorage");
    }
  }, [storageKey]);

  // Save drawings to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.drawings));
    } catch {
      console.warn("Failed to save drawings to localStorage");
    }
  }, [state.drawings, storageKey]);

  const selectTool = useCallback((type: Drawing["type"] | null) => {
    setState((prev) => ({
      ...prev,
      activeTool: type,
      currentPoints: [],
    }));
  }, []);

  const addPoint = useCallback((point: Point) => {
    setState((prev) => {
      if (!prev.activeTool) return prev;

      const tool = DRAWING_TOOLS.find((t) => t.type === prev.activeTool);
      if (!tool) return prev;

      const newPoints = [...prev.currentPoints, point];

      // Auto-complete if we have enough points
      if (newPoints.length >= tool.minPoints) {
        const drawing = createDrawing(prev.activeTool, newPoints);
        return {
          ...prev,
          drawings: [...prev.drawings, drawing],
          currentPoints: [],
          activeTool: null, // Auto-deselect after drawing
        };
      }

      return {
        ...prev,
        currentPoints: newPoints,
      };
    });
  }, []);

  const removeDrawing = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      drawings: prev.drawings.filter((d) => d.id !== id),
    }));
  }, []);

  const clearAllDrawings = useCallback(() => {
    setState((prev) => ({
      ...prev,
      drawings: [],
      currentPoints: [],
    }));
  }, []);

  const undoLastDrawing = useCallback(() => {
    setState((prev) => ({
      ...prev,
      drawings: prev.drawings.slice(0, -1),
    }));
  }, []);

  return {
    activeTool: state.activeTool,
    drawings: state.drawings,
    currentPoints: state.currentPoints,
    isDrawing: state.currentPoints.length > 0,
    selectTool,
    addPoint,
    removeDrawing,
    clearAllDrawings,
    undoLastDrawing,
  };
}