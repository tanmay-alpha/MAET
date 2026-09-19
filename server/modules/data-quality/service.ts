import { db } from "../../data/drizzle/client";
import { sourceAudit, anomalyFlags, ingestionRuns, quoteSnapshots, fundamentals } from "../../db/schema";
import { eq, desc, sql, and, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export function assertAdmin(ctx: { userId?: string | null; role?: "user" | "admin" }) {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  }
  if (ctx.role !== "admin") {
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

export async function resolveAnomaly(anomalyId: string, resolvedBy: string, resolutionNote?: string) {
  const [updated] = await db
    .update(anomalyFlags)
    .set({
      isResolved: true,
      resolvedAt: new Date(),
      resolvedBy,
      resolutionNote: resolutionNote ?? `Resolved by ${resolvedBy || "admin"}`,
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

  const jobId = crypto.randomUUID();
  const retryTimestamp = new Date();

  // Atomic state claim: only claim if not already running or retry_pending
  const [claimed] = await db
    .update(ingestionRuns)
    .set({
      status: "retry_pending",
      metadata: sql`jsonb_set(
        coalesce(${ingestionRuns.metadata}, '{}'::jsonb),
        '{lastRetryJobId}',
        to_jsonb(${jobId}::text)
      )`,
    })
    .where(
      and(
        eq(ingestionRuns.id, batch.id),
        notInArray(ingestionRuns.status, ["running", "retry_pending"])
      )
    )
    .returning();

  if (!claimed) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Retry job already active for batch ${batchId} (status: ${batch.status})`,
    });
  }

  await db
    .update(ingestionRuns)
    .set({
      status: "running",
      retryCount: sql`${ingestionRuns.retryCount} + 1`,
    })
    .where(eq(ingestionRuns.id, batch.id));

  let finalStatus: "succeeded" | "partial" | "failed" = "succeeded";
  let errorSummary: string | null = null;

  try {
    // Synchronous bounded retry: execute ingestion pipeline step preserving target scope if specified
    const { runDailyProcessor } = await import("../../workers/daily-processor");
    const targetSymbols = (batch.metadata as any)?.symbols as string[] | undefined;
    const stats = await runDailyProcessor(targetSymbols ? { symbols: targetSymbols } : undefined);
    if (stats.errors && stats.errors.length > 0) {
      if (stats.symbolsProcessed === 0 && stats.candlesWritten === 0 && stats.fundamentalsSynced === 0) {
        finalStatus = "failed";
        errorSummary = stats.errors.join("; ").slice(0, 500);
      } else {
        finalStatus = "partial";
        errorSummary = `Completed with ${stats.errors.length} error(s): ${stats.errors.slice(0, 3).join("; ")}`.slice(0, 500);
      }
    }
  } catch (err: any) {
    finalStatus = "failed";
    errorSummary = err?.message ?? "Ingestion pipeline retry failed";
  }

  // State Transition 2: running -> succeeded | partial | failed
  const [updated] = await db
    .update(ingestionRuns)
    .set({
      status: finalStatus,
      completedAt: new Date(),
      errorSummary,
      metadata: {
        ...((batch.metadata as object) ?? {}),
        lastRetryJobId: jobId,
        retryCompletedAt: new Date().toISOString(),
      },
    })
    .where(eq(ingestionRuns.id, batch.id))
    .returning();

  return {
    success: finalStatus === "succeeded",
    jobId,
    batchId,
    status: finalStatus,
    attemptCount: updated ? updated.retryCount : batch.retryCount + 1,
    retryTimestamp: retryTimestamp.toISOString(),
    errorSummary,
  };
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
