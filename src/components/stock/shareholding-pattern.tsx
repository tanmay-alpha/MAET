import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Users, TrendingUp, Building2, User } from "lucide-react";

interface ShareholderCategory {
  name: string;
  percentage: number;
  change: number;
  icon: typeof Users;
  color: string;
}

const mockShareholding: ShareholderCategory[] = [
  {
    name: "Promoters",
    percentage: 51.2,
    change: -0.5,
    icon: User,
    color: "bg-blue-600",
  },
  {
    name: "Foreign Institutional Investors",
    percentage: 18.5,
    change: 1.2,
    icon: TrendingUp,
    color: "bg-emerald-600",
  },
  {
    name: "Domestic Institutional Investors",
    percentage: 12.8,
    change: 0.8,
    icon: Building2,
    color: "bg-amber-600",
  },
  {
    name: "Public / Retail",
    percentage: 17.5,
    change: -1.5,
    icon: Users,
    color: "bg-slate-500",
  },
];

export function ShareholdingPattern() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Shareholding Pattern</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {mockShareholding.map((category, index) => {
          const Icon = category.icon;
          const changeColor = category.change >= 0 ? "text-bull" : "text-bear";
          return (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{category.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-sm ${changeColor}`}>
                    {category.change >= 0 ? "+" : ""}
                    {category.change.toFixed(1)}%
                  </span>
                  <span className="font-mono text-sm font-semibold">
                    {category.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
              <Progress
                value={category.percentage}
                className="h-2"
                indicatorClassName={category.color}
              />
            </div>
          );
        })}

        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            Last updated: Q4 FY 2024 • Source: BSE/NSE Filings
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
