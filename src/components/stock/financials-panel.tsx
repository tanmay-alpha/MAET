import { FileText, Table2, TrendingUp } from "lucide-react";
import { ContractPanel } from "@/components/common/contract-panel";

type Statement = "balance_sheet" | "pl" | "cashflow";

interface FinancialStatementsPanelProps {
  symbol: string;
  active: Statement;
}

const LABELS: Record<Statement, string> = {
  balance_sheet: "Balance Sheet",
  pl: "Profit & Loss",
  cashflow: "Cash Flow",
};

export function FinancialStatementsPanel({ symbol, active }: FinancialStatementsPanelProps) {
  const messages: Record<Statement, string> = {
    balance_sheet: `${symbol} balance sheet — connect a fundamentals API (NSE/BSE/Alpha Vantage) to see assets, liabilities, and equity.`,
    pl: `${symbol} P&L — connect a fundamentals API to see revenue, EBITDA, net profit, and EPS history.`,
    cashflow: `${symbol} cash flow — connect a fundamentals API to see operating, investing, and financing cash flows.`,
  };

  const icons: Record<Statement, React.ReactNode> = {
    balance_sheet: <Table2 className="h-5 w-5 text-muted-foreground" />,
    pl: <TrendingUp className="h-5 w-5 text-muted-foreground" />,
    cashflow: <FileText className="h-5 w-5 text-muted-foreground" />,
  };

  return (
    <div className="space-y-3">
      <ContractPanel symbol={symbol} message={messages[active]} />
    </div>
  );
}
