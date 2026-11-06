const wholeRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const MINUS = "\u2212";

/** Whole rupees, halves away from zero, so a ₹24,212.50 loss and debit both show ₹24,213. */
function roundRupees(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** "₹2,600", "−₹3,900". Rounded to whole rupees: position P&L, not tick prices. */
export function formatRupees(value: number): string {
  const rounded = roundRupees(value);
  return `${rounded < 0 ? MINUS : ""}₹${wholeRupees.format(Math.abs(rounded))}`;
}

/** "+₹2,600", "−₹3,900", "₹0". */
export function formatSignedRupees(value: number): string {
  return roundRupees(value) > 0 ? `+${formatRupees(value)}` : formatRupees(value);
}

export function formatPrice(value: number, digits = 2): string {
  const text = Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return value < 0 && Number(text.replace(/,/g, "")) !== 0 ? `${MINUS}${text}` : text;
}

export function pnlTone(value: number): string {
  const rounded = roundRupees(value);
  if (rounded > 0) return "text-bull";
  if (rounded < 0) return "text-bear";
  return "text-muted-foreground";
}
