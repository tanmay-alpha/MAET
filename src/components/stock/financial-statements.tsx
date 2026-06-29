import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "./stat-card";
import { ContractPanel } from "@/components/common/contract-panel";

interface FinancialData {
  period: string;
  revenue: number;
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
}

interface BalanceSheetItem {
  label: string;
  value: number;
  percentage?: number;
}

const mockBalanceSheet: BalanceSheetItem[] = [
  { label: "Total Shareholders' Equity", value: 2345678000000 },
  { label: "Total Non-Current Assets", value: 1234567000000 },
  { label: "Total Current Assets", value: 2345678000000 },
  { label: "Total Liabilities", value: 2345678000000 },
  { label: "Short-term Debt", value: 567890000000 },
  { label: "Long-term Debt", value: 1234567000000 },
];

const mockProfitLoss: FinancialData[] = [
  {
    period: "FY 2024",
    revenue: 1000000000000,
    netIncome: 200000000000,
    totalAssets: 3500000000000,
    totalLiabilities: 1700000000000,
    totalEquity: 1800000000000,
    operatingCashFlow: 300000000000,
    investingCashFlow: -100000000000,
    financingCashFlow: -200000000000,
  },
  {
    period: "FY 2023",
    revenue: 900000000000,
    netIncome: 180000000000,
    totalAssets: 3200000000000,
    totalLiabilities: 1650000000000,
    totalEquity: 1550000000000,
    operatingCashFlow: 280000000000,
    investingCashFlow: -120000000000,
    financingCashFlow: -150000000000,
  },
];

export function FinancialStatements() {
  const [selectedPeriod, setSelectedPeriod] = useState("FY 2024");
  const currentData = mockProfitLoss.find(d => d.period === selectedPeriod);

  if (!currentData) {
    return <ContractPanel message="Financial statements data loading..." />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Financial Statements</CardTitle>
          <Tabs value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <TabsList className="grid w-[200px] grid-cols-2">
              <TabsTrigger value="FY 2024">FY 2024</TabsTrigger>
              <TabsTrigger value="FY 2023">FY 2023</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="balance-sheet" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="profit-loss">P&L Statement</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
          </TabsList>

          <TabsContent value="balance-sheet" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard
                icon={null}
                label="Total Assets"
                value={`₹${(currentData.totalAssets / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Total Liabilities"
                value={`₹${(currentData.totalLiabilities / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Total Equity"
                value={`₹${(currentData.totalEquity / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Debt/Equity"
                value={((currentData.totalLiabilities - currentData.totalEquity) / currentData.totalEquity).toFixed(2)}
              />
            </div>

            <div className="mt-4">
              <h4 className="font-semibold mb-3">Balance Sheet Breakdown</h4>
              <div className="space-y-2">
                {mockBalanceSheet.map((item, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm">{item.label}</span>
                    <div className="text-right">
                      <span className="font-mono text-sm">₹{(item.value / 1000000000).toFixed(1)}B</span>
                      {item.percentage !== undefined && (
                        <span className="text-xs text-muted-foreground ml-2">({item.percentage.toFixed(1)}%)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="profit-loss" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                icon={null}
                label="Revenue"
                value={`₹${(currentData.revenue / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Net Income"
                value={`₹${(currentData.netIncome / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Net Margin"
                value={`${((currentData.netIncome / currentData.revenue) * 100).toFixed(2)}%`}
              />
            </div>
          </TabsContent>

          <TabsContent value="cash-flow" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                icon={null}
                label="Operating CF"
                value={`₹${(currentData.operatingCashFlow / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Investing CF"
                value={`₹${(currentData.investingCashFlow / 1000000000).toFixed(1)}B`}
              />
              <StatCard
                icon={null}
                label="Financing CF"
                value={`₹${(currentData.financingCashFlow / 1000000000).toFixed(1)}B`}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}