import { useMemo, useCallback } from "react";
import { useSearch, useNavigate, useLocation } from "@tanstack/react-router";
import {
  type SymbolContext,
  parseSymbolContext,
  DEFAULT_SYMBOL_CONTEXT,
} from "@/lib/symbol-context";
import { useTerminalStore } from "@/store/useTerminalStore";

export function useActiveSymbol(): {
  context: SymbolContext;
  setSymbolContext: (next: Partial<SymbolContext>) => void;
  activeSymbol: string;
  activeExchange: "NSE" | "BSE";
} {
  const location = useLocation();
  const searchParams = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const storeSymbol = useTerminalStore((state) => state.activeSymbol);
  const setStoreSymbol = useTerminalStore((state) => state.setActiveSymbol);

  const context = useMemo(() => {
    const parsed = parseSymbolContext(searchParams);
    if (!searchParams.symbol && storeSymbol) {
      return {
        ...parsed,
        symbol: storeSymbol,
      };
    }
    return parsed;
  }, [searchParams, storeSymbol]);

  const setSymbolContext = useCallback(
    (next: Partial<SymbolContext>) => {
      const updated: SymbolContext = {
        ...context,
        ...next,
        symbol: next.symbol ? next.symbol.toUpperCase() : context.symbol,
      };

      setStoreSymbol(updated.symbol);

      const isTerminal = location.pathname.startsWith("/terminal");
      if (isTerminal) {
        void navigate({
          to: "/terminal",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            symbol: updated.symbol,
            exchange: updated.exchange,
            companyId: updated.companyId,
            sourceContext: updated.sourceContext,
            screenerRunId: updated.screenerRunId,
          }),
          replace: true,
        });
      }
    },
    [context, location.pathname, navigate, setStoreSymbol]
  );

  return {
    context,
    setSymbolContext,
    activeSymbol: context.symbol || DEFAULT_SYMBOL_CONTEXT.symbol,
    activeExchange: context.exchange || DEFAULT_SYMBOL_CONTEXT.exchange,
  };
}
