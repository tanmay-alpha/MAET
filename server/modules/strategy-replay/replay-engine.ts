/**
 * Strategy Replay Engine — Isolated Replay Trading Account & Execution Ledger.
 *
 * Provides step-by-step bar revelation, replay order entry, next-bar fill execution,
 * isolated replay position tracking, and dedicated ledger logging.
 *
 * REAL PAPER TRADING ACCOUNTS (paper_accounts, paper_orders, paper_fills) REMAIN 100% UNTOUCHED.
 */

export interface ReplayOrder {
  id: string;
  sessionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  price?: number;
  quantity: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
}

export interface ReplayFill {
  id: string;
  orderId: string;
  sessionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  fees: number;
  timestamp: number;
}

export interface ReplayPosition {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  unrealizedPnl: number;
  currentPrice: number;
}

export interface ReplayLedgerEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  description: string;
  amount: number;
  balanceAfter: number;
}

export interface ReplaySessionState {
  id: string;
  userId: string;
  symbol: string;
  timeframe: string;
  currentBarIndex: number;
  initialBalance: number;
  cashBalance: number;
  equity: number;
  orders: ReplayOrder[];
  fills: ReplayFill[];
  positions: Record<string, ReplayPosition>;
  ledger: ReplayLedgerEntry[];
}

const sessionsMap = new Map<string, ReplaySessionState>();

export function createReplaySession(id: string, userId: string, symbol: string, timeframe: string, initialBalance = 100000): ReplaySessionState {
  const session: ReplaySessionState = {
    id,
    userId,
    symbol,
    timeframe,
    currentBarIndex: 0,
    initialBalance,
    cashBalance: initialBalance,
    equity: initialBalance,
    orders: [],
    fills: [],
    positions: {},
    ledger: [{
      id: `ledg-init-${id}`,
      sessionId: id,
      timestamp: Date.now(),
      description: "Initial Replay Balance Deposit",
      amount: initialBalance,
      balanceAfter: initialBalance,
    }],
  };

  sessionsMap.set(id, session);
  return session;
}

export function getReplaySession(id: string): ReplaySessionState | null {
  return sessionsMap.get(id) ?? null;
}

export function placeReplayOrder(input: {
  sessionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  price?: number;
  quantity: number;
}): ReplayOrder {
  const session = sessionsMap.get(input.sessionId);
  if (!session) throw new Error(`Replay session ${input.sessionId} not found`);

  const order: ReplayOrder = {
    id: `rord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId: input.sessionId,
    symbol: input.symbol,
    side: input.side,
    orderType: input.orderType,
    price: input.price,
    quantity: input.quantity,
    status: "PENDING",
    createdAt: Date.now(),
  };

  session.orders.push(order);
  return order;
}

export function cancelReplayOrder(sessionId: string, orderId: string): boolean {
  const session = sessionsMap.get(sessionId);
  if (!session) return false;

  const order = session.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "PENDING") return false;

  order.status = "CANCELLED";
  return true;
}

export function revealNextBar(sessionId: string, candle: { open: number; high: number; low: number; close: number; ts: string | number }): {
  session: ReplaySessionState;
  executedFills: ReplayFill[];
} {
  const session = sessionsMap.get(sessionId);
  if (!session) throw new Error(`Replay session ${sessionId} not found`);

  session.currentBarIndex++;
  const candleTs = typeof candle.ts === "string" ? new Date(candle.ts).getTime() : candle.ts;
  const executedFills: ReplayFill[] = [];

  const feeRate = 0.0003; // 0.03% replay fee

  for (const order of session.orders) {
    if (order.status !== "PENDING") continue;

    let fillPrice: number | null = null;

    if (order.orderType === "MARKET") {
      fillPrice = candle.open; // Market order fills at next bar open
    } else if (order.orderType === "LIMIT" && order.price != null) {
      if (order.side === "BUY" && candle.low <= order.price) {
        fillPrice = Math.min(candle.open, order.price);
      } else if (order.side === "SELL" && candle.high >= order.price) {
        fillPrice = Math.max(candle.open, order.price);
      }
    } else if (order.orderType === "STOP" && order.price != null) {
      if (order.side === "BUY" && candle.high >= order.price) {
        fillPrice = Math.max(candle.open, order.price);
      } else if (order.side === "SELL" && candle.low <= order.price) {
        fillPrice = Math.min(candle.open, order.price);
      }
    }

    if (fillPrice != null) {
      order.status = "FILLED";
      order.filledAt = candleTs;
      order.fillPrice = fillPrice;

      const grossCost = fillPrice * order.quantity;
      const fees = grossCost * feeRate;

      const fill: ReplayFill = {
        id: `rfill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        orderId: order.id,
        sessionId,
        symbol: order.symbol,
        side: order.side,
        price: fillPrice,
        quantity: order.quantity,
        fees,
        timestamp: candleTs,
      };

      session.fills.push(fill);
      executedFills.push(fill);

      // Update cash & position
      const pos = session.positions[order.symbol] ?? {
        symbol: order.symbol,
        quantity: 0,
        avgEntryPrice: 0,
        unrealizedPnl: 0,
        currentPrice: fillPrice,
      };

      if (order.side === "BUY") {
        session.cashBalance -= (grossCost + fees);
        const newQty = pos.quantity + order.quantity;
        const newAvg = newQty > 0 ? ((pos.quantity * pos.avgEntryPrice) + grossCost) / newQty : 0;
        pos.quantity = newQty;
        pos.avgEntryPrice = newAvg;
      } else {
        session.cashBalance += (grossCost - fees);
        pos.quantity -= order.quantity;
      }

      pos.currentPrice = candle.close;
      pos.unrealizedPnl = pos.quantity * (candle.close - pos.avgEntryPrice);
      session.positions[order.symbol] = pos;

      session.ledger.push({
        id: `ledg-${Date.now()}`,
        sessionId,
        timestamp: candleTs,
        description: `Replay Fill ${order.side} ${order.quantity} ${order.symbol} @ ₹${fillPrice.toFixed(2)}`,
        amount: order.side === "BUY" ? -(grossCost + fees) : (grossCost - fees),
        balanceAfter: session.cashBalance,
      });
    }
  }

  // Update position prices & total equity
  let positionValue = 0;
  for (const pos of Object.values(session.positions)) {
    pos.currentPrice = candle.close;
    pos.unrealizedPnl = pos.quantity * (candle.close - pos.avgEntryPrice);
    positionValue += pos.quantity * candle.close;
  }

  session.equity = session.cashBalance + positionValue;
  return { session, executedFills };
}
