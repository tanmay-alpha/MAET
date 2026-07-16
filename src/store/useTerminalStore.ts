import { create } from "zustand";

export interface Level2Entry {
  price: number;
  qty: number;
}

export interface OptionGreeks {
  delta: number;
  theta: number;
  vega: number;
  gamma?: number;
}

interface TerminalState {
  activeSymbol: string;
  level2Depth: {
    bids: Level2Entry[];
    asks: Level2Entry[];
  } | null;
  activeGreeks: OptionGreeks | null;
  setActiveSymbol: (symbol: string) => void;
  setLevel2Depth: (depth: { bids: Level2Entry[]; asks: Level2Entry[] } | null) => void;
  setActiveGreeks: (greeks: OptionGreeks | null) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  activeSymbol: "RELIANCE", // Initial default symbol from WATCHLIST
  level2Depth: null,
  activeGreeks: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol, level2Depth: null, activeGreeks: null }),
  setLevel2Depth: (depth) => set({ level2Depth: depth }),
  setActiveGreeks: (greeks) => set({ activeGreeks: greeks }),
}));
