import { defineEventHandler } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const service = createPaperTradingService();
    const state = await service.getState({ userId: auth.userId });
    const ledgerResult = await service.listLedger({
      userId: auth.userId,
      generation: state.account.generation,
      limit: 100,
    });

    return {
      success: true,
      account: {
        ...state.account,
        cashBalance: Number(state.account.cashBalance),
        allocatedMargin: Number(state.account.allocatedMargin),
        initialCash: Number(state.account.initialCash),
        realisedPnl: Number(state.account.realisedPnl),
      },
      cashBalance: Number(state.account.cashBalance),
      generation: state.account.generation,
      version: state.account.version,
      status: state.account.status,
      positions: state.positions.map((p) => ({
        ...p,
        quantity: Number(p.quantity),
        averagePrice: Number(p.averagePrice),
      })),
      orders: state.orders.map((o) => ({
        ...o,
        qty: Number(o.qty),
        quantity: Number(o.qty),
        limitPrice: o.limitPrice ? Number(o.limitPrice) : undefined,
        stopPrice: o.stopPrice ? Number(o.stopPrice) : undefined,
      })),
      fills: state.fills.map((f) => ({
        ...f,
        qty: Number(f.qty),
        fillPrice: Number(f.fillPrice),
      })),
      ledger: ledgerResult.entries.map((l) => ({
        ...l,
        amount: Number(l.amount),
      })),
      asOf: state.asOf.toISOString(),
    };
  } catch (error: unknown) {
    console.error("[api/paper/account.get] Error:", error);
    throw error;
  }
});
