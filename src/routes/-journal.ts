/** Closed paper trades are the account's flat positions; nothing else is reviewable. */
export function closedTrades<T extends { totalShares: number }>(positions: T[]): T[] {
  return positions.filter((position) => position.totalShares === 0);
}

export function rupees(value: number | string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function signedRupees(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${rupees(Math.abs(value))}`;
}
