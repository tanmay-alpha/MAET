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
      account: state.account,
      cashBalance: state.account.cashBalance,
      generation: state.account.generation,
      version: state.account.version,
      status: state.account.status,
      positions: state.positions,
      orders: state.orders,
      fills: state.fills,
      ledger: ledgerResult.entries,
      asOf: state.asOf.toISOString(),
    };
  } catch (error: unknown) {
    console.error("[api/paper/account.get] Error:", error);
    throw error;
  }
});
