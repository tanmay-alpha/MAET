import { defineEventHandler } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const service = createPaperTradingService();
    const account = await service.resetAccount({ userId: auth.userId, confirmation: true });

    return {
      success: true,
      message: "Account reset successfully",
      account: {
        userId: account.userId,
        generation: account.generation,
        version: account.version,
        cashBalance: account.cashBalance,
        allocatedMargin: account.allocatedMargin,
        status: account.status,
      },
    };
  } catch (error: any) {
    console.error("[api/paper/account.post] Error:", error);
    throw error;
  }
});

