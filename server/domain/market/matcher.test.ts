import { mock } from "bun:test";

// In-memory mock tables
let mockAccounts: any[] = [];
let mockPositions: any[] = [];
let mockOrders: any[] = [];
let testMarketCapBucket = "large";
let testAvgVolume = 3000000;

class QueryBuilder {
  private tableName: string = "";
  private operation: string = "";
  private data: any = null;
  private targetId: string | null = null;
  private targetUserId: string | null = null;
  private targetSymbol: string | null = null;

  constructor(operation: string) {
    this.operation = operation;
  }

  select(...args: any[]) { return this; }
  from(table: any) {
    if (!table) return this;
    
    // Extract table name from Drizzle table object
    if (typeof table === "string") {
      this.tableName = table;
    } else if (table.tableName) {
      this.tableName = table.tableName;
    } else if (table._?.name) {
      this.tableName = table._.name;
    } else {
      const symbols = Object.getOwnPropertySymbols(table);
      for (const sym of symbols) {
        if (sym.toString().includes("drizzle:Name") || sym.toString().includes("drizzle:TableName")) {
          this.tableName = table[sym];
          break;
        }
      }
      if (!this.tableName && table.name) {
        this.tableName = table.name;
      }
    }
    
    return this;
  }
  
  leftJoin(...args: any[]) { return this; }

  // Recursively extract column filter values from Drizzle AST/SQL representation
  private extractConditions(clause: any) {
    if (!clause) return;

    if (Array.isArray(clause)) {
      let currentColumnName: string | null = null;
      for (const chunk of clause) {
        if (chunk && typeof chunk === "object") {
          // If it's a Drizzle Column object
          if (chunk.name !== undefined && chunk.table !== undefined) {
            currentColumnName = chunk.name;
          }
          // If it's a Param object containing the value (it should NOT be a StringChunk which has value as an array)
          else if (chunk.value !== undefined && !Array.isArray(chunk.value) && currentColumnName) {
            const col = currentColumnName;
            const val = chunk.value;
            if (col === "id") this.targetId = val;
            if (col === "user_id") this.targetUserId = val;
            if (col === "symbol") this.targetSymbol = val;
            currentColumnName = null;
          }
          // Recurse into nested SQL query chunks
          else if (Array.isArray(chunk.queryChunks)) {
            this.extractConditions(chunk.queryChunks);
          }
        }
      }
    } else if (clause.queryChunks) {
      this.extractConditions(clause.queryChunks);
    }
  }

  where(cond: any) {
    this.extractConditions(cond);
    return this;
  }

  limit(n: number) {
    if (this.tableName === "companies" || this.tableName === "") {
      return [{ marketCapBucket: testMarketCapBucket, avgVolume: testAvgVolume }];
    }
    return [];
  }
  
  for(mode: string) {
    return this.execute();
  }

  update(table: any) {
    this.from(table);
    this.operation = "update";
    return this;
  }

  set(data: any) {
    this.data = data;
    return this;
  }

  insert(table: any) {
    this.from(table);
    this.operation = "insert";
    return this;
  }

  values(data: any) {
    this.data = data;
    return this;
  }

  onConflictDoUpdate(args: any) {
    this.execute();
    return this;
  }

  delete(table: any) {
    this.from(table);
    this.operation = "delete";
    return this;
  }

  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      const res = this.execute();
      return Promise.resolve(res).then(onfulfilled, onrejected);
    } catch (e) {
      return Promise.reject(e).then(onfulfilled, onrejected);
    }
  }

  private execute() {
    const isOrdersTable = this.tableName === "paper_orders";
    const isAccountsTable = this.tableName === "paper_accounts";
    const isPositionsTable = this.tableName === "paper_positions";
    const isCompaniesTable = this.tableName === "companies";

    if (this.operation === "select") {
      if (isOrdersTable) {
        return mockOrders.filter(o => o.status === "PENDING" || o.status === "TRIGGER_PENDING" || o.status === "PARTIALLY_FILLED");
      }
      if (isAccountsTable) {
        return mockAccounts;
      }
      if (isPositionsTable) {
        return mockPositions;
      }
      if (isCompaniesTable) {
        return [{ marketCapBucket: testMarketCapBucket, avgVolume: testAvgVolume }];
      }
    }
    if (this.operation === "update") {
      if (isOrdersTable) {
        if (this.targetId) {
          const match = mockOrders.find(o => o.id === this.targetId);
          if (match) Object.assign(match, this.data);
        } else {
          for (const o of mockOrders) {
            Object.assign(o, this.data);
          }
        }
        return [this.data];
      }
      if (isAccountsTable) {
        if (mockAccounts.length > 0) {
          Object.assign(mockAccounts[0], this.data);
        }
        return [this.data];
      }
      if (isPositionsTable) {
        const existing = mockPositions.find(p => p.symbol === this.targetSymbol);
        if (existing) {
          Object.assign(existing, this.data);
        }
        return [this.data];
      }
    }
    if (this.operation === "insert") {
      if (isPositionsTable) {
        const existing = mockPositions.find(p => p.symbol === this.data.symbol);
        if (existing) {
          Object.assign(existing, this.data);
        } else {
          mockPositions.push(this.data);
        }
        return [this.data];
      }
      if (isOrdersTable) {
        mockOrders.push(this.data);
        return [this.data];
      }
    }
    if (this.operation === "delete") {
      if (isPositionsTable) {
        if (this.targetId) {
          mockPositions = mockPositions.filter(p => p.id !== this.targetId);
        } else if (this.targetSymbol) {
          mockPositions = mockPositions.filter(p => p.symbol !== this.targetSymbol);
        } else {
          mockPositions = [];
        }
      }
      return [];
    }
    return [];
  }
}

const mockDbClient = {
  select: () => new QueryBuilder("select"),
  update: (table: any) => new QueryBuilder("update").update(table),
  insert: (table: any) => new QueryBuilder("insert").insert(table),
  delete: (table: any) => new QueryBuilder("delete").delete(table),
  transaction: async (cb: any) => {
    return await cb(mockDbClient);
  }
};

mock.module("../../data/drizzle/client", () => {
  return {
    db: mockDbClient,
    closeDb: () => {},
  };
});

// Now import the rest of the dependencies
import { describe, it, expect, beforeEach } from "bun:test";
import { calculateSlippage, getLiquidityTier } from "./slippage";
import { onTick } from "./matcher";

describe("Slippage Engine (Almgren-Chriss)", () => {
  it("classifies liquidity tiers correctly based on volume and cap", () => {
    expect(getLiquidityTier(2500000)).toBe("HIGH");
    expect(getLiquidityTier(500000)).toBe("MEDIUM");
    expect(getLiquidityTier(50000)).toBe("LOW");
    expect(getLiquidityTier(undefined, "large")).toBe("HIGH");
    expect(getLiquidityTier(undefined, "mid")).toBe("MEDIUM");
    expect(getLiquidityTier(undefined, "small")).toBe("LOW");
    expect(getLiquidityTier(undefined, undefined)).toBe("MEDIUM");
  });

  it("calculates slippage with Almgren-Chriss formulation", () => {
    const ltp = 1000;
    const orderQty = 1000;
    const slippage = calculateSlippage(ltp, orderQty, 3000000, "large", 0.02);
    expect(slippage).toBeCloseTo(0.730738, 4);
  });
});

describe("Order Matching Engine (Mocked Integration)", () => {
  const testUserId = "test-user-id";
  const TEST_SYMBOL = "TMATCH";

  beforeEach(() => {
    mockAccounts = [
      {
        userId: testUserId,
        cashBalance: "10000000.0000",
        allocatedMargin: "0.0000",
        maintenanceMargin: "0.0000",
        leverageFactor: 5,
        liquidationThreshold: "0.1000",
      }
    ];
    mockPositions = [];
    mockOrders = [];
    testMarketCapBucket = "large";
    testAvgVolume = 3000000;
  });

  it("executes a MARKET BUY order and creates a position with slippage and fee", async () => {
    const orderId = "order-1";
    
    mockOrders.push({
      id: orderId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      executionType: "GOOD_TILL_CANCELLED",
      qty: 100,
    });

    const receipts = await onTick(TEST_SYMBOL, 1000, 999, 1001, 5000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(receipts[0].orderId).toBe(orderId);

    expect(mockOrders[0].status).toBe("FILLED");
    expect(mockOrders[0].filledQty).toBe(100);

    const slippage = Number(mockOrders[0].slippageApplied);
    const fillPrice = Number(mockOrders[0].averageFillPrice);
    expect(fillPrice).toBeCloseTo(1001 + slippage, 4);

    expect(mockPositions.length).toBe(1);
    expect(mockPositions[0].totalShares).toBe(100);
    expect(Number(mockPositions[0].averageEntryPrice)).toBeCloseTo(fillPrice, 4);
  });

  it("handles passive queue-priority LIMIT order matching", async () => {
    const buyOrderId = "order-buy";
    const sellOrderId = "order-sell";

    mockOrders.push({
      id: buyOrderId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 50,
      limitPrice: "998.0000",
    });

    mockOrders.push({
      id: sellOrderId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "LIMIT",
      status: "PENDING",
      qty: 50,
      limitPrice: "1002.0000",
    });

    let receipts = await onTick(TEST_SYMBOL, 1000, 999, 1001, 1000);
    expect(receipts.length).toBe(0);

    receipts = await onTick(TEST_SYMBOL, 997, 997, 998, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(buyOrderId);
    expect(receipts[0].price).toBe(998.0000);

    mockOrders = mockOrders.filter(o => o.id !== buyOrderId);

    receipts = await onTick(TEST_SYMBOL, 1002, 1002, 1003, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(sellOrderId);
    expect(receipts[0].price).toBe(1002.0000);
  });

  it("rejects orders that exceed free margin limits", async () => {
    mockAccounts[0].cashBalance = "2000.0000";

    const orderId = "order-margin-fail";
    mockOrders.push({
      id: orderId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      qty: 500,
    });

    const receipts = await onTick(TEST_SYMBOL, 1000, 999, 1001, 5000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("REJECTED");
    expect(receipts[0].rejectReason).toBe("Insufficient margin");
    expect(mockOrders[0].status).toBe("REJECTED");
  });

  it("handles Bracket Order chains and OCO cancellations", async () => {
    const parentId = "bracket-parent";

    mockOrders.push({
      id: parentId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 10,
      limitPrice: "1000.0000",
      stopLossPrice: "990.0000",
      takeProfitPrice: "1010.0000",
    });

    let receipts = await onTick(TEST_SYMBOL, 999, 999, 1000, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(parentId);

    const tpOrder = mockOrders.find(c => c.parentOrderId === parentId && c.type === "LIMIT")!;
    const slOrder = mockOrders.find(c => c.parentOrderId === parentId && c.type === "STOP_LOSS_LIMIT")!;

    expect(tpOrder).toBeDefined();
    expect(slOrder).toBeDefined();
    expect(tpOrder.status).toBe("PENDING");
    expect(slOrder.status).toBe("TRIGGER_PENDING");

    // Tick the price to exactly 990 to trigger AND match the Sell Stop Loss Limit order
    receipts = await onTick(TEST_SYMBOL, 990, 990, 991, 1000);
    
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(slOrder.id);
    expect(receipts[0].status).toBe("FILLED");

    expect(tpOrder.status).toBe("CANCELLED");
    expect(mockPositions.length).toBe(0);
  });

  it("triggers auto-liquidation when equity drops below maintenance margin", async () => {
    mockAccounts[0].cashBalance = "25000.0000";

    mockPositions.push({
      id: "pos-1",
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      averageEntryPrice: "1000.0000",
      totalShares: 100,
      realizedPnl: "0.0000",
      unrealizedPnl: "0.0000",
      marginLocked: "20000.0000",
    });

    mockAccounts[0].allocatedMargin = "20000.0000";
    mockAccounts[0].maintenanceMargin = "16000.0000";

    // Tick price drops to 800 - triggers auto-liquidation instantly inside onTick
    await onTick(TEST_SYMBOL, 800, 799, 801, 5000);

    // Verify position was liquidated
    expect(mockPositions.length).toBe(0);

    // Verify a liquidation order was added and filled
    const liqOrder = mockOrders.find(o => o.type === "MARKET" && o.status === "FILLED");
    expect(liqOrder).toBeDefined();
    expect(liqOrder?.side).toBe("SELL");

    // Verify margin reset
    expect(Number(mockAccounts[0].allocatedMargin)).toBe(0);
    expect(Number(mockAccounts[0].maintenanceMargin)).toBe(0);
  });

  it("tracks HWM and triggers trailing stops", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].isLocked = false;
    mockAccounts[0].cashBalance = "1000000.0000";
    mockAccounts[0].allocatedMargin = "0.0000";
    mockAccounts[0].maintenanceMargin = "0.0000";

    const trailingOrder = {
      id: "trailing-1",
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      status: "TRIGGER_PENDING",
      qty: 10,
      trailingDistance: "10.0000",
      isTrailingPercent: false,
      trailingHwm: null,
      trailingLwm: null,
      stopPrice: null,
    };
    mockOrders.push(trailingOrder);

    // First tick: initialize HWM and stopPrice
    let receipts = await onTick(TEST_SYMBOL, 1000, 1000, 1000, 1000);
    expect(receipts.length).toBe(0);
    expect(trailingOrder.trailingHwm).toBe("1000");
    expect(trailingOrder.stopPrice).toBe("990");
    expect(trailingOrder.status).toBe("TRIGGER_PENDING");

    // Second tick: price goes up to 1010, HWM should update, stopPrice updates to 1000
    receipts = await onTick(TEST_SYMBOL, 1010, 1010, 1010, 1000);
    expect(receipts.length).toBe(0);
    expect(trailingOrder.trailingHwm).toBe("1010");
    expect(trailingOrder.stopPrice).toBe("1000");

    // Third tick: price falls to 1005 (above stopPrice), nothing triggers
    receipts = await onTick(TEST_SYMBOL, 1005, 1005, 1005, 1000);
    expect(receipts.length).toBe(0);
    expect(trailingOrder.trailingHwm).toBe("1010");
    expect(trailingOrder.stopPrice).toBe("1000");

    // Fourth tick: price falls to 999 (below stopPrice), triggers market sell order
    receipts = await onTick(TEST_SYMBOL, 999, 999, 999, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(trailingOrder.status).toBe("FILLED");
  });

  it("rejects orders for locked accounts", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].isLocked = true;

    const normalOrder = {
      id: "order-locked",
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 10,
      limitPrice: "1000.0000",
    };
    mockOrders.push(normalOrder);

    const receipts = await onTick(TEST_SYMBOL, 990, 990, 990, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("REJECTED");
    expect(receipts[0].rejectReason).toBe("Account locked due to margin call");
    expect(normalOrder.status).toBe("REJECTED");
  });

  it("handles partial fills based on tick volume", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].isLocked = false;
    mockAccounts[0].cashBalance = "1000000.0000";

    const largeLimitOrder = {
      id: "large-limit-1",
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 100,
      filledQty: 0,
      limitPrice: "1000.0000",
    };
    mockOrders.push(largeLimitOrder);

    // Tick volume is 30, so fill qty should be capped at 30
    let receipts = await onTick(TEST_SYMBOL, 990, 990, 990, 30);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("PARTIALLY_FILLED");
    expect(largeLimitOrder.status).toBe("PARTIALLY_FILLED");
    expect(largeLimitOrder.filledQty).toBe(30);
    expect(mockPositions.length).toBe(1);
    expect(mockPositions[0].totalShares).toBe(30);

    // Next tick volume is 80, remaining is 70, so it should fully fill
    receipts = await onTick(TEST_SYMBOL, 990, 990, 990, 80);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(largeLimitOrder.status).toBe("FILLED");
    expect(largeLimitOrder.filledQty).toBe(100);
    expect(mockPositions[0].totalShares).toBe(100);
  });

  it("triggers stop-loss limit order during a gap-down (market conversion)", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].isLocked = false;
    mockAccounts[0].cashBalance = "1000000.0000";

    const slLimitOrder = {
      id: "sl-limit-gap",
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      status: "TRIGGER_PENDING",
      qty: 10,
      filledQty: 0,
      stopPrice: "1000.0000",
      limitPrice: "995.0000",
    };
    mockOrders.push(slLimitOrder);

    // Price gaps down from 1010 to 980 (below stopPrice of 1000 AND limitPrice of 995)
    // Gap protection should convert it to a MARKET order and match it at 980
    const receipts = await onTick(TEST_SYMBOL, 980, 980, 980, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(slLimitOrder.type).toBe("MARKET");
    expect(slLimitOrder.status).toBe("FILLED");
    expect(Number(slLimitOrder.averageFillPrice)).toBeLessThan(995); // filled at gap price
  });

  it("cancels OCO sibling order completely or adjusts size on partial fill", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].isLocked = false;

    const parentId = "bracket-parent-oco";
    const tpOrder = {
      id: "tp-oco",
      parentOrderId: parentId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "LIMIT",
      status: "PENDING",
      qty: 10,
      filledQty: 0,
      limitPrice: "1010.0000",
    };
    const slOrder = {
      id: "sl-oco",
      parentOrderId: parentId,
      userId: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      status: "TRIGGER_PENDING",
      qty: 10,
      filledQty: 0,
      stopPrice: "990.0000",
      limitPrice: "990.0000",
    };
    mockOrders.push(tpOrder, slOrder);

    // 1. Partial fill TP order by 3 shares. Sibling SL order should have quantity reduced by 3
    let receipts = await onTick(TEST_SYMBOL, 1010, 1010, 1010, 3);
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe("tp-oco");
    expect(receipts[0].status).toBe("PARTIALLY_FILLED");
    expect(tpOrder.filledQty).toBe(3);
    expect(slOrder.qty).toBe(7); // reduced qty to match remaining position size

    // 2. Full fill TP order on next tick. Sibling SL order should be completely cancelled
    receipts = await onTick(TEST_SYMBOL, 1010, 1010, 1010, 1000);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(slOrder.status).toBe("CANCELLED");
  });
});
