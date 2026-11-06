export const rupees = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(2)}%`;

export function serverMarkLabel(timestamp: string | null): string {
  if (timestamp === null) return "Server mark time unavailable (entry-price valuation).";
  const time = new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return `Valued at last server mark, ${time} IST (oldest price).`;
}
