import type { ReactNode } from "react";

interface StatCardProps {
  icon?: ReactNode;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
}

export function StatCard({ icon: Icon, label, value, sub, trend }: StatCardProps) {
  const trendColor = trend === "up" ? "text-bull" : trend === "down" ? "text-bear" : "";

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2">
        {Icon && <span className="h-4 w-4 text-muted-foreground">{Icon}</span>}
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${trendColor}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
