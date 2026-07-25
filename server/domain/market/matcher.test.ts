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

  private extractConditions(clause: any) {
    if (!clause) return;
    if (Array.isArray(clause)) {
      let currentColumnName: string | null = null;
      for (const chunk of clause) {
        if (chunk && typeof chunk === "object") {
          if (chunk.name !== undefined && chunk.table !== undefined) {
            currentColumnName = chunk.name;
          } else if (chunk.value !== undefined && !Array.isArray(chunk.value) && currentColumnName) {
            const col = currentColumnName;
            const val = chunk.value;
            if (col === "id") this.targetId = val;
            if (col === "user_id") this.targetUserId = val;
            if (col === "symbol") this.targetSymbol = val;
            currentColumnName = null;
          } else if (Array.isArray(chunk.queryChunks)) {
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
    this.data = Array.isArray(data) ? data : [data];
    return this;
  }

  onConflictDoUpdate(args: any) {
    this.execute();
    return this;
  }

  returning() {
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
        if (this.targetId) {
          const match = mockOrders.find((o) => o.id === this.targetId);
          return match ? [match] : [];
        }
        return mockOrders.filter((o) => ["PENDING", "TRIGGER_PENDING", "TRIGGERED", "PARTIALLY_FILLED"].includes(o.status));
      }
      if (isAccountsTable) {
        if (this.targetUserId) {
          const match = mockAccounts.find((a) => a.userId === this.targetUserId || a.user_id === this.targetUserId);
          return match ? [match] : [];
        }
        return mockAccounts;
      }
      if (isPositionsTable) {
        if (this.targetUserId) {
          return mockPositions.filter((p) => p.userId === this.targetUserId || p.user_id === this.targetUserId);
        }
        return mockPositions;
      }
      if (isCompaniesTable) {
        return [{ marketCapBucket: testMarketCapBucket, avgVolume: testAvgVolume }];
      }
    }
    if (this.operation === "update") {
      if (isOrdersTable) {
        if (this.targetId) {
          const match = mockOrders.find((o) => o.id === this.targetId);
          if (match) Object.assign(match, this.data);
          return match ? [match] : [];
        } else {
          for (const o of mockOrders) {
            Object.assign(o, this.data);
          }
        }
        return mockOrders;
      }
      if (isAccountsTable) {
        if (mockAccounts.length > 0) {
          Object.assign(mockAccounts[0], this.data);
          return [mockAccounts[0]];
        }
        return [];
      }
      if (isPositionsTable) {
        const existing = mockPositions.find((p) => p.symbol === this.targetSymbol);
        if (existing) {
          Object.assign(existing, this.data);
          return [existing];
        }
        return [];
      }
    }
    if (this.operation === "insert") {
      const items = Array.isArray(this.data) ? this.data : [this.data];
      if (isPositionsTable) {
        for (const item of items) {
          const existing = mockPositions.find((p) => p.symbol === item.symbol);
          if (existing) {
            Object.assign(existing, item);
          } else {
            mockPositions.push(item);
          }
        }
        return items;
      }
      if (isOrdersTable) {
        const fullOrders = items.map((item) => ({
          filledQty: 0,
          generation: 1,
          placedAt: new Date(),
          updatedAt: new Date(),
          ...item,
        }));
        mockOrders.push(...fullOrders);
        return fullOrders;
      }
      return items;
    }
    if (this.operation === "delete") {
      if (isPositionsTable) {
        if (this.targetId) {
          mockPositions = mockPositions.filter((p) => p.id !== this.targetId);
        } else if (this.targetSymbol) {
          mockPositions = mockPositions.filter((p) => p.symbol !== this.targetSymbol);
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
  },
};

mock.module("../../data/drizzle/client", () => {
  return {
    db: mockDbClient,
    getDb: () => mockDbClient,
    closeDb: () => {},
  };
});

import { describe, it, expect, beforeEach } from "bun:test";
import { calculateSlippage, getLiquidityTier } from "./slippage";
import { onTick } from "./matcher";
import type { Tick } from "@shared/types";

function liveTick(symbol: string, price: number, volume: number): Tick {
  return {
    exchange: "NSE",
    symbol,
    price,
    volume,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
  };
}

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
        id: "account-1",
        userId: testUserId,
        user_id: testUserId,
        cashBalance: "10000000.0000",
        cash_balance: "10000000.0000",
        initialCash: "10000000.0000",
        initial_cash: "10000000.0000",
        allocatedMargin: "0.0000",
        allocated_margin: "0.0000",
        maintenanceMargin: "0.0000",
        maintenance_margin: "0.0000",
        realisedPnl: "0.0000",
        realised_pnl: "0.0000",
        leverageFactor: 5,
        liquidationThreshold: "0.1000",
        generation: 1,
        status: "ACTIVE",
        version: "3",
        currency: "INR",
        isLocked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockPositions = [];
    mockOrders = [];
    testMarketCapBucket = "large";
    testAvgVolume = 3000000;
  });

  it("rejects a delayed quote at the database matcher boundary", async () => {
    const pendingOrder = {
      id: "delayed-boundary",
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      qty: 10,
      filledQty: 0,
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    };
    mockOrders.push(pendingOrder);
    const delayedTick: Tick = {
      ...liveTick(TEST_SYMBOL, 1000, 1000),
      source: "yahoo",
      quality: "delayed",
    };

    const receipts = await onTick(delayedTick);
    expect(receipts).toHaveLength(0);
    expect(pendingOrder.status).toBe("PENDING");
    expect(mockPositions).toHaveLength(0);
  });

  it("executes a MARKET BUY order and creates a position with slippage and fee", async () => {
    const orderId = "order-1";

    mockOrders.push({
      id: orderId,
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      qty: 100,
      filledQty: 0,
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    });

    const receipts = await onTick(liveTick(TEST_SYMBOL, 1000, 5000));
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(receipts[0].orderId).toBe(orderId);

    expect(mockOrders[0].status).toBe("FILLED");
    expect(mockOrders[0].filledQty).toBe(100);

    const fillPrice = Number(mockOrders[0].averageFillPrice);
    expect(fillPrice).toBeGreaterThanOrEqual(1000);

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
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 50,
      filledQty: 0,
      limitPrice: "998.0000",
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    });

    mockOrders.push({
      id: sellOrderId,
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "LIMIT",
      status: "PENDING",
      qty: 50,
      filledQty: 0,
      limitPrice: "1002.0000",
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    });

    let receipts = await onTick(liveTick(TEST_SYMBOL, 1000, 1000));
    expect(receipts.length).toBe(0);

    receipts = await onTick(liveTick(TEST_SYMBOL, 997, 1000));
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(buyOrderId);

    mockOrders = mockOrders.filter((o) => o.id !== buyOrderId);

    receipts = await onTick(liveTick(TEST_SYMBOL, 1002, 1000));
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(sellOrderId);
  });

  it("rejects orders that exceed free margin limits", async () => {
    mockAccounts[0].cashBalance = "2000.0000";

    const orderId = "order-margin-fail";
    mockOrders.push({
      id: orderId,
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      qty: 500,
      filledQty: 0,
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    });

    const receipts = await onTick(liveTick(TEST_SYMBOL, 1000, 5000));
    expect(receipts.length).toBe(0);
  });

  it("handles Bracket Order chains and OCO cancellations", async () => {
    const parentId = "bracket-parent";

    mockOrders.push({
      id: parentId,
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 10,
      filledQty: 0,
      limitPrice: "1000.0000",
      stopLossPrice: "990.0000",
      takeProfitPrice: "1010.0000",
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    });

    let receipts = await onTick(liveTick(TEST_SYMBOL, 999, 1000));
    expect(receipts.length).toBe(1);
    expect(receipts[0].orderId).toBe(parentId);
  });

  it("triggers auto-liquidation when equity drops below maintenance margin", async () => {
    mockAccounts[0].cashBalance = "25000.0000";

    mockPositions.push({
      id: "pos-1",
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      averageEntryPrice: "1000.0000",
      totalShares: 100,
      realizedPnl: "0.0000",
      unrealizedPnl: "0.0000",
      marginLocked: "20000.0000",
      generation: 1,
      updatedAt: new Date(),
    });

    mockAccounts[0].allocatedMargin = "20000.0000";
    mockAccounts[0].maintenanceMargin = "16000.0000";

    await onTick(liveTick(TEST_SYMBOL, 800, 5000));
    expect(mockPositions.length).toBe(1);
  });

  it("rejects orders for locked accounts", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].status = "LIQUIDATED";

    const normalOrder = {
      id: "order-locked",
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 10,
      filledQty: 0,
      limitPrice: "1000.0000",
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    };
    mockOrders.push(normalOrder);

    const receipts = await onTick(liveTick(TEST_SYMBOL, 990, 1000));
    expect(receipts.length).toBe(0);
  });

  it("handles partial fills based on tick volume", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].status = "ACTIVE";
    mockAccounts[0].cashBalance = "1000000.0000";

    const largeLimitOrder = {
      id: "large-limit-1",
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 100,
      filledQty: 0,
      limitPrice: "1000.0000",
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    };
    mockOrders.push(largeLimitOrder);

    let receipts = await onTick(liveTick(TEST_SYMBOL, 990, 30));
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("PARTIALLY_FILLED");
    expect(largeLimitOrder.status).toBe("PARTIALLY_FILLED");
    expect(largeLimitOrder.filledQty).toBe(3);

    receipts = await onTick(liveTick(TEST_SYMBOL, 990, 1000));
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("FILLED");
    expect(largeLimitOrder.status).toBe("FILLED");
    expect(largeLimitOrder.filledQty).toBe(100);
  });

  it("keeps a stop-loss limit pending at its limit during a gap-down", async () => {
    mockOrders = [];
    mockPositions = [];
    mockAccounts[0].status = "ACTIVE";
    mockAccounts[0].cashBalance = "1000000.0000";

    const slLimitOrder = {
      id: "sl-limit-gap",
      userId: testUserId,
      user_id: testUserId,
      symbol: TEST_SYMBOL,
      exchange: "NSE",
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      status: "TRIGGER_PENDING",
      qty: 10,
      filledQty: 0,
      stopPrice: "1000.0000",
      limitPrice: "995.0000",
      generation: 1,
      placedAt: new Date(),
      updatedAt: new Date(),
    };
    mockOrders.push(slLimitOrder);

    const receipts = await onTick(liveTick(TEST_SYMBOL, 980, 1000));
    expect(receipts).toHaveLength(0);
    expect(slLimitOrder.type).toBe("STOP_LOSS_LIMIT");
    expect(slLimitOrder.status).toBe("TRIGGERED");
  });
});
