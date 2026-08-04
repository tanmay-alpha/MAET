import { db } from "../../data/drizzle/client";
import { tradeTheses, thesisSignals, thesisSnapshots, thesisOrderLinks } from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { CreateThesisInput, LinkOrderToThesisInput } from "@shared/research/contracts";

export class TradeThesisRepository {
  async listTheses(userId: string) {
    return db
      .select()
      .from(tradeTheses)
      .where(eq(tradeTheses.userId, userId))
      .orderBy(desc(tradeTheses.updatedAt));
  }

  async getThesisById(userId: string, thesisId: string) {
    const [thesis] = await db
      .select()
      .from(tradeTheses)
      .where(and(eq(tradeTheses.id, thesisId), eq(tradeTheses.userId, userId)));

    if (!thesis) return null;

    const signals = await db
      .select()
      .from(thesisSignals)
      .where(eq(thesisSignals.thesisId, thesisId));

    const snapshots = await db
      .select()
      .from(thesisSnapshots)
      .where(eq(thesisSnapshots.thesisId, thesisId))
      .orderBy(desc(thesisSnapshots.createdAt));

    const orderLinks = await db
      .select()
      .from(thesisOrderLinks)
      .where(eq(thesisOrderLinks.thesisId, thesisId));

    return {
      ...thesis,
      signals,
      snapshots,
      orderLinks,
    };
  }

  async createThesis(userId: string, input: CreateThesisInput) {
    const [created] = await db
      .insert(tradeTheses)
      .values({
        userId,
        symbol: input.symbol,
        exchange: input.exchange || "NSE",
        screenerRunId: input.screenerRunId,
        workspaceId: input.workspaceId,
        title: input.title,
        setupType: input.setupType,
        direction: input.direction,
        hypothesis: input.hypothesis,
        entryPlan: input.entryPlan,
        stopPrice: input.stopPrice ? String(input.stopPrice) : null,
        targetPrice: input.targetPrice ? String(input.targetPrice) : null,
        riskAmount: input.riskAmount ? String(input.riskAmount) : null,
        riskPercent: input.riskPercent ? String(input.riskPercent) : null,
        status: "PLANNED",
      })
      .returning();

    return created;
  }

  async captureSnapshot(thesisId: string, quotePrice: number, quoteSource: string, quoteQuality: string, timeframe: string) {
    const [snapshot] = await db
      .insert(thesisSnapshots)
      .values({
        thesisId,
        quotePrice: String(quotePrice),
        quoteSource,
        quoteQuality,
        quoteTimestamp: new Date(),
        timeframe,
      })
      .returning();

    return snapshot;
  }

  async linkOrder(thesisId: string, input: LinkOrderToThesisInput) {
    const [link] = await db
      .insert(thesisOrderLinks)
      .values({
        thesisId,
        paperOrderId: input.paperOrderId,
        relationship: input.relationship,
      })
      .returning();

    return link;
  }
}

export const tradeThesisRepository = new TradeThesisRepository();
