import { db } from "../../data/drizzle/client";
import { sourceAudit, anomalyFlags, ingestionRuns, deadLetterQueue, companies, quoteSnapshots, fundamentals } from "../../db/schema";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export function assertAdmin(ctx: { userId?: string | null; isAdmin?: boolean; userRole?: string }) {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  }
  if (!ctx.isAdmin && ctx.userRole !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin authorization required for Data Quality operations" });
  }
}

export async function getDataQualityOverview() {
  const [totalAuditsRow] = await db.select({ count: sql`count(*)` }).from(sourceAudit);
  const [openAnomaliesRow] = await db
    .select({ count: sql`count(*)` })
    .from(anomalyFlags)
    .where(eq(anomalyFlags.isResolved, false));

  const recentBatches = await db
    .select()
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(10);

  return {
    totalAudits: Number(totalAuditsRow?.count ?? 0),
    openAnomalies: Number(openAnomaliesRow?.count ?? 0),
    recentBatches,
  };
}

export async function listAudits(limit = 20) {
  const items = await db.select().from(sourceAudit).orderBy(desc(sourceAudit.createdAt)).limit(limit);
  return { items };
}

export async function listAnomalies(limit = 20) {
  const items = await db.select().from(anomalyFlags).orderBy(desc(anomalyFlags.detectedAt)).limit(limit);
  return { items };
}

export async function resolveAnomaly(anomalyId: string, resolutionNote?: string) {
  const [updated] = await db
    .update(anomalyFlags)
    .set({
      isResolved: true,
      resolvedAt: new Date(),
      resolvedBy: "admin",
      resolutionNote: resolutionNote ?? "Resolved by admin",
    })
    .where(eq(anomalyFlags.id, anomalyId))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly flag not found" });
  }
  return { success: true, anomaly: updated };
}

export async function suppressAnomaly(anomalyId: string) {
  const suppressionUntil = new Date(Date.now() + 7 * 86400000); // 7 days suppression
  const [updated] = await db
    .update(anomalyFlags)
    .set({
      suppressionUntil,
      resolutionNote: "Suppressed for 7 days",
    })
    .where(eq(anomalyFlags.id, anomalyId))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly flag not found" });
  }
  return { success: true, anomaly: updated };
}

export async function retryBatch(batchId: string) {
  const [batch] = await db
    .select()
    .from(ingestionRuns)
    .where(eq(ingestionRuns.batchId, batchId))
    .limit(1);

  if (!batch) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Batch run not found" });
  }

  await db
    .update(ingestionRuns)
    .set({
      status: "running",
      retryCount: sql`${ingestionRuns.retryCount} + 1`,
    })
    .where(eq(ingestionRuns.id, batch.id));

  return { success: true, batchId, status: "queued_retry" };
}

export async function getDataCoverage() {
  const [quotesCount] = await db.select({ count: sql`count(distinct ${quoteSnapshots.companyId})` }).from(quoteSnapshots);
  const [fundamentalsCount] = await db.select({ count: sql`count(distinct ${fundamentals.companyId})` }).from(fundamentals);
  const [lastIngestion] = await db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(1);

  return {
    companiesWithQuotes: Number(quotesCount?.count ?? 0),
    companiesWithFundamentals: Number(fundamentalsCount?.count ?? 0),
    lastIngestion: lastIngestion ? lastIngestion.startedAt.toISOString() : null,
  };
}
