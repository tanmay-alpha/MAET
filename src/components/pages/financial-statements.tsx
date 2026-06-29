/**
 * Financial Statements Component
 * Displays Balance Sheet, P&L, and Cash Flow data
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatCrores } from "@/lib/financial-metrics";
import type { FinancialStatement } from "@/lib/financial-statements";

interface FinancialStatementsProps {
  statements: {
    balanceSheet: FinancialStatement;
    plStatement: FinancialStatement;
    cashFlow: FinancialStatement;
  };
}

export function FinancialStatements({ statements }: FinancialStatementsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Statements</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="balance-sheet" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="pl">P&L</TabsTrigger>
            <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          </TabsList>

          <TabsContent value="balance-sheet">
            <FinancialStatementTable statement={statements.balanceSheet} />
          </TabsContent>

          <TabsContent value="pl">
            <FinancialStatementTable statement={statements.plStatement} />
          </TabsContent>

          <TabsContent value="cashflow">
            <FinancialStatementTable statement={statements.cashFlow} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface FinancialStatementTableProps {
  statement: FinancialStatement;
}

function FinancialStatementTable({ statement }: FinancialStatementTableProps) {
  const [selectedPeriod, setSelectedPeriod] = useState("FY2025");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {statement.periods.map((period) => (
          <Badge
            key={period}
            variant={selectedPeriod === period ? "default" : "outline"}
            onClick={() => setSelectedPeriod(period)}
            className="cursor-pointer"
          >
            {period}
          </Badge>
        ))}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Particulars</th>
              {statement.years.map((year) => (
                <th key={year} className="px-4 py-2 text-right font-medium">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statement.sections.map((section, sIdx) => (
              <tbody key={section.name}>
                <tr className="bg-muted/50">
                  <td
                    colSpan={3}
                    className="px-4 py-2 font-semibold text-sm"
                  >
                    {section.name}
                  </td>
                </tr>
                {section.lineItems.map((item, iIdx) => (
                  <tr key={`${sIdx}-${iIdx}`} className="border-t">
                    <td className="px-4 py-2 pl-8 text-muted-foreground">
                      {item.label}
                    </td>
                    {statement.years.map((year) => (
                      <td
                        key={year}
                        className="px-4 py-2 text-right font-mono"
                      >
                        {formatCrores(item.values[year] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}