import { create } from "zustand";

interface TerminalState {
  activeSymbol: string;
  setActiveSymbol: (symbol: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  activeSymbol: "RELIANCE", // Initial default symbol from WATCHLIST
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),
}));
