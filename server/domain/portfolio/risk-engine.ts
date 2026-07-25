import { db } from "../../data/drizzle/client";
import { sql, eq } from "drizzle-orm";
import { paperAccounts } from "../../db/schema";

export class RiskEngine {
  private static instance: RiskEngine | null = null;
  private prices = new Map<string, number>();
  private isMonitoring = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  public static getInstance(): RiskEngine {
    if (!RiskEngine.instance) {
      RiskEngine.instance = new RiskEngine();
    }
    return RiskEngine.instance;
  }

  public updatePrice(symbol: string, price: number): void {
    this.prices.set(symbol.toUpperCase(), price);
  }

  public start(intervalMs = 2000): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.timer = setInterval(async () => {
      try {
        await this.monitorRisk();
      } catch (err) {
        console.error("[RiskEngine] error during risk monitoring:", err);
      }
    }, intervalMs);
    console.log(`[RiskEngine] Started background risk monitoring at ${intervalMs}ms interval`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isMonitoring = false;
    console.log("[RiskEngine] Stopped background risk monitoring");
  }

  public async monitorRisk(): Promise<void> {
    if (this.prices.size === 0) return;

    const livePricesObj = Object.fromEntries(this.prices.entries());
    const livePricesJson = JSON.stringify(livePricesObj);

    const query = sql`SELECT * FROM calculate_live_margin(${livePricesJson}::jsonb)`;
    const breachedAccounts = await db.execute<{
      user_id: string;
      cash_balance: string;
      allocated_margin: string;
      maintenance_margin: string;
      total_upnl: string;
      equity: string;
      breached: boolean;
    }>(query);

    const accounts = breachedAccounts;
    if (accounts.length === 0) return;

    console.warn(`[RiskEngine] Detected ${accounts.length} breached accounts requiring liquidation`);

    for (const breached of accounts) {
      const userId = breached.user_id;
      try {
        await db.transaction(async (tx) => {
          const [account] = await tx
            .select()
            .from(paperAccounts)
            .where(eq(paperAccounts.userId, userId))
            .for("update");

          if (!account || account.isLocked) {
            return;
          }

          await tx
            .update(paperAccounts)
            .set({
              status: "LIQUIDATED",
              isLocked: true,
              lockReason: "MARGIN_CALL_LIQUIDATION",
              lockedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(paperAccounts.userId, userId));
        });
      } catch (err) {
        console.error(`[RiskEngine] Failed to liquidate breached account for user ${userId}:`, err);
      }
    }
  }
}

export const riskEngine = RiskEngine.getInstance();
