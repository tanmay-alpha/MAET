export * from "./schemas";

export interface CreateThesisInput {
  symbol: string;
  exchange?: "NSE" | "BSE";
  screenerRunId?: string;
  workspaceId?: string;
  title: string;
  setupType: string;
  direction: "LONG" | "SHORT" | "WATCH";
  hypothesis: string;
  entryPlan?: string;
  stopPrice?: number;
  targetPrice?: number;
  riskAmount?: number;
  riskPercent?: number;
}

export interface LinkOrderToThesisInput {
  thesisId: string;
  paperOrderId: string;
  relationship: "ENTRY" | "ADD" | "REDUCE" | "EXIT" | "STOP" | "TARGET";
}

export interface CreateTradeReviewInput {
  thesisId: string;
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN" | "CANCELLED" | "INVALIDATED";
  reviewText: string;
  ruleFollowed?: boolean;
  mistakes?: string;
  lessons?: string;
}
