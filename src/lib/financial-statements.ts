/**
 * Financial Statement Types for Frontend
 */

export interface FinancialStatementLineItem {
  label: string;
  values: Record<string, number>;
}

export interface FinancialStatementSection {
  name: string;
  lineItems: FinancialStatementLineItem[];
}

export interface FinancialStatement {
  periods: string[];
  years: string[];
  sections: FinancialStatementSection[];
}
