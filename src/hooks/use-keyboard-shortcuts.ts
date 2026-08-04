import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export function useKeyboardShortcuts(options?: {
  onSelectSide?: (side: "BUY" | "SELL") => void;
  onSelectInterval?: (tf: string) => void;
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

      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>("input[placeholder*='Search']");
        searchInput?.focus();
        return;
      }

      if (e.key === "s" || e.key === "S") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          void navigate({ to: "/screener" });
          return;
        }
      }

      if (e.key === "t" || e.key === "T") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          void navigate({ to: "/terminal" });
          return;
        }
      }

      if (e.key === "B" && e.shiftKey) {
        e.preventDefault();
        options?.onSelectSide?.("SELL");
        return;
      }

      if (e.key === "b" || e.key === "B") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          options?.onSelectSide?.("BUY");
          return;
        }
      }

      if (["1", "5"].includes(e.key)) {
        options?.onSelectInterval?.(`${e.key}m`);
        return;
      }

      if (e.key === "D" || e.key === "d") {
        options?.onSelectInterval?.("1D");
        return;
      }

      if (e.key === "W" || e.key === "w") {
        options?.onSelectInterval?.("1W");
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, options]);
}
