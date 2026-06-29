/**
 * useKeyboardShortcuts - Keyboard shortcuts for chart workspace
 */

import { useEffect, useCallback } from "react";

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
  category: "navigation" | "tools" | "view" | "indicators";
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  onShortcut?: (shortcut: KeyboardShortcut) => void;
}

const DEFAULT_SHORTCUTS: Omit<KeyboardShortcut, "handler">[] = [
  // Timeframe shortcuts
  { key: "1", description: "1 minute", category: "navigation" },
  { key: "5", description: "5 minutes", category: "navigation" },
  { key: "15", description: "15 minutes", category: "navigation" },
  { key: "30", description: "30 minutes", category: "navigation" },
  { key: "1h", description: "1 hour", category: "navigation" },
  { key: "4h", description: "4 hours", category: "navigation" },
  { key: "1d", description: "1 day", category: "navigation" },
  { key: "1w", description: "1 week", category: "navigation" },

  // View shortcuts
  { key: "f", ctrl: true, description: "Toggle fullscreen", category: "view" },
  { key: "Escape", description: "Cancel current action", category: "view" },
  { key: "z", ctrl: true, description: "Undo", category: "view" },
  { key: "y", ctrl: true, description: "Redo", category: "view" },

  // Drawing tool shortcuts
  { key: "t", description: "Trendline tool", category: "tools" },
  { key: "s", description: "Support tool", category: "tools" },
  { key: "r", description: "Resistance tool", category: "tools" },
  { key: "f", description: "Fibonacci tool", category: "tools" },
  { key: "Delete", description: "Delete selected", category: "tools" },

  // Indicator shortcuts
  { key: "m", description: "Moving average", category: "indicators" },
  { key: "v", description: "Volume", category: "indicators" },
  { key: "r", ctrl: true, description: "RSI", category: "indicators" },
  { key: "m", ctrl: true, description: "MACD", category: "indicators" },
];

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true, onShortcut } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
        const shiftMatches = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatches = shortcut.alt ? event.altKey : !event.altKey;

        if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
          event.preventDefault();
          shortcut.handler();
          onShortcut?.(shortcut);
          return;
        }
      }
    },
    [enabled, shortcuts, onShortcut]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// Hook for timeframe shortcuts
export function useTimeframeShortcuts(
  onTimeframeChange: (timeframe: string) => void
) {
  const shortcuts: KeyboardShortcut[] = [
    { key: "1", handler: () => onTimeframeChange("1m"), description: "1 minute", category: "navigation" },
    { key: "2", handler: () => onTimeframeChange("2m"), description: "2 minutes", category: "navigation" },
    { key: "3", handler: () => onTimeframeChange("3m"), description: "3 minutes", category: "navigation" },
    { key: "5", handler: () => onTimeframeChange("5m"), description: "5 minutes", category: "navigation" },
    { key: "15", handler: () => onTimeframeChange("15m"), description: "15 minutes", category: "navigation" },
    { key: "30", handler: () => onTimeframeChange("30m"), description: "30 minutes", category: "navigation" },
    { key: "1H", handler: () => onTimeframeChange("1h"), description: "1 hour", category: "navigation" },
    { key: "2H", handler: () => onTimeframeChange("2h"), description: "2 hours", category: "navigation" },
    { key: "4H", handler: () => onTimeframeChange("4h"), description: "4 hours", category: "navigation" },
    { key: "1D", handler: () => onTimeframeChange("1d"), description: "1 day", category: "navigation" },
    { key: "1W", handler: () => onTimeframeChange("1w"), description: "1 week", category: "navigation" },
    { key: "1M", handler: () => onTimeframeChange("1mo"), description: "1 month", category: "navigation" },
  ];

  return useKeyboardShortcuts(shortcuts);
}

// Hook for drawing tool shortcuts
export function useDrawingToolShortcuts(
  onToolSelect: (tool: string | null) => void
) {
  const shortcuts: KeyboardShortcut[] = [
    { key: "t", handler: () => onToolSelect("trendline"), description: "Trendline", category: "tools" },
    { key: "s", handler: () => onToolSelect("support"), description: "Support", category: "tools" },
    { key: "R", handler: () => onToolSelect("resistance"), description: "Resistance", category: "tools" },
    { key: "F", handler: () => onToolSelect("fibonacci"), description: "Fibonacci", category: "tools" },
    { key: "Escape", handler: () => onToolSelect(null), description: "Cancel tool", category: "tools" },
  ];

  return useKeyboardShortcuts(shortcuts);
}