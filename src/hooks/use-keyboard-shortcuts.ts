import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { LayoutType } from "@shared/research/contracts";

export function useKeyboardShortcuts(options?: {
  onSelectSide?: (side: "BUY" | "SELL") => void;
  onSelectInterval?: (tf: string) => void;
  onChangeLayout?: (layout: LayoutType) => void;
  onSelectTool?: (tool: string) => void;
  onOpenAlertModal?: () => void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Do not trigger shortcuts when typing inside form inputs
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        if (e.key === "Escape") {
          target.blur();
        }
        return;
      }

      // Alt layout shortcuts
      if (e.altKey && e.key === "1") {
        e.preventDefault();
        options?.onChangeLayout?.("SINGLE");
        return;
      }
      if (e.altKey && e.shiftKey && e.key === "@") { // Alt+Shift+2
        e.preventDefault();
        options?.onChangeLayout?.("HORIZONTAL_2");
        return;
      }
      if (e.altKey && e.key === "2") {
        e.preventDefault();
        options?.onChangeLayout?.("VERTICAL_2");
        return;
      }
      if (e.altKey && e.key === "4") {
        e.preventDefault();
        options?.onChangeLayout?.("GRID_4");
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>("input[placeholder*='Search']");
        searchInput?.focus();
        return;
      }

      if (e.key === "s" || e.key === "S") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          void navigate({ to: "/screener" });
          return;
        }
      }

      if (e.key === "t" || e.key === "T") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          void navigate({ to: "/terminal" });
          return;
        }
      }

      if (e.key === "j" || e.key === "J") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          void navigate({ to: "/journal" as any });
          return;
        }
      }

      if (e.key === "a" || e.key === "A") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          options?.onOpenAlertModal?.();
          return;
        }
      }

      if (e.key === "B" && e.shiftKey) {
        e.preventDefault();
        options?.onSelectSide?.("SELL");
        return;
      }

      if (e.key === "b" || e.key === "B") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          options?.onSelectSide?.("BUY");
          return;
        }
      }

      if (["1", "5"].includes(e.key) && !e.altKey) {
        options?.onSelectInterval?.(`${e.key}m`);
        return;
      }

      if ((e.key === "D" || e.key === "d") && !e.altKey) {
        options?.onSelectInterval?.("1D");
        return;
      }

      if ((e.key === "W" || e.key === "w") && !e.altKey) {
        options?.onSelectInterval?.("1W");
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, options]);
}
