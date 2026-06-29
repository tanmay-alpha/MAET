import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractPanel } from "@/components/common/contract-panel";
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Scale,
  BarChart3,
  Activity,
} from "lucide-react";

interface KeyRatio {
  label: string;
  value: string;
  icon: typeof Calculator;
  benchmark?: string;
  trend?: "up" | "down" | "neutral";
}

const mockRatios: KeyRatio[] = [
  { label: "P/E Ratio", value: "24.5", icon: Calculator, benchmark: "Industry: 28.3" },
  { label: "P/B Ratio", value: "3.2", icon: BarChart3, benchmark: "Industry: 4.1" },
  { label: "ROE", value: "18.5%", icon: TrendingUp, trend: "up" },
  { label: "ROCE", value: "22.3%", icon: Activity, trend: "up" },
  { label: "Debt/Equity", value: "0.45", icon: Scale, benchmark: "Industry: 0.8" },
  { label: "Current Ratio", value: "1.85", icon: Percent, trend: "neutral" },
  { label: "Dividend Yield", value: "1.8%", icon: DollarSign },
  { label: "EPS (TTM)", value: "₹42.5", icon: TrendingUp },
];

export function KeyRatios() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Key Ratios</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {mockRatios.map((ratio, index) => {
            const Icon = ratio.icon;
            const trendColor =
              ratio.trend === "up"
                ? "text-bull"
                : ratio.trend === "down"
                ? "text-bear"
                : "";
            return (
              <div
                key={index}
                className="rounded-lg border border-border bg-panel p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {ratio.label}
                  </div>
                </div>
                <div className={`font-mono text-xl font-semibold ${trendColor}`}>
                  {ratio.value}
                </div>
                {ratio.benchmark && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {ratio.benchmark}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
