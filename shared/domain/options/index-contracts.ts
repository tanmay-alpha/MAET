export interface IndexContractDefaults {
  /** Units per lot. */
  lotSize: number;
  /** Strike interval nearest the money, used to place template strikes. */
  strikeStep: number;
}

/**
 * Index option defaults. Lot sizes follow NSE circular NSE/FAOP/70616 (Circular Ref. No.
 * 176/2025, 3 October 2025, "Revision in Market Lot of Derivative Contracts on Indices"):
 * NIFTY 75 → 65, BANKNIFTY 35 → 30, FINNIFTY 65 → 60, carried by every live contract from
 * 31 December 2025. NSE revises lots periodically, so the UI keeps them editable.
 * https://nsearchives.nseindia.com/content/circulars/FAOP70616.pdf
 */
export const INDEX_CONTRACT_DEFAULTS: Readonly<Record<string, IndexContractDefaults>> = {
  NIFTY: { lotSize: 65, strikeStep: 50 },
  BANKNIFTY: { lotSize: 30, strikeStep: 100 },
  FINNIFTY: { lotSize: 60, strikeStep: 50 },
};

export function indexContractDefaults(symbol: string): IndexContractDefaults | undefined {
  return INDEX_CONTRACT_DEFAULTS[symbol.trim().toUpperCase()];
}
