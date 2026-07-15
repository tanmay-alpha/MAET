import { db } from "../../data/drizzle/client";
import { sql, eq } from "drizzle-orm";
import { paperAccounts } from "../../db/schema";
import { liquidateAccount } from "../market/matcher";

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

  /**
   * Update the price cache with live tick data
   */
  public updatePrice(symbol: string, price: number): void {
    this.prices.set(symbol.toUpperCase(), price);
  }

  /**
   * Start the periodic risk engine monitor loop (defaults to checking every 2 seconds)
   */
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

  /**
   * Stop the risk monitoring loop
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isMonitoring = false;
    console.log("[RiskEngine] Stopped background risk monitoring");
  }

  /**
   * Query PL/pgSQL function to locate accounts breaching margin requirements and trigger liquidations
   */
  public async monitorRisk(): Promise<void> {
    if (this.prices.size === 0) return;

    const livePricesObj = Object.fromEntries(this.prices.entries());
    const livePricesJson = JSON.stringify(livePricesObj);

    // Call Supabase DB custom PL/pgSQL calculate_live_margin function
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
          // Lock the account to prevent order placement races
          const [account] = await tx
            .select()
            .from(paperAccounts)
            .where(eq(paperAccounts.userId, userId))
            .for("update");

          if (!account || account.isLocked) {
            return; // Already locked or liquidated
          }

          // Trigger portfolio-wide liquidation
          // Symbol/ltp fallbacks are resolved dynamically using quoteStore inside liquidateAccount
          await liquidateAccount(tx, userId);
        });
      } catch (err) {
        console.error(`[RiskEngine] Failed to liquidate breached account for user ${userId}:`, err);
      }
    }
  }
}

export const riskEngine = RiskEngine.getInstance();
