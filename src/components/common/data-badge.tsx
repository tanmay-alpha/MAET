interface DataBadgeProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
}

export function DataBadge({ label, value, trend }: DataBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-mono tabular ${
        trend === "up" ? "text-bull" : trend === "down" ? "text-bear" : "text-foreground"
      }`}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
      </span>
    </span>
  );
}