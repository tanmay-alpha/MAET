/**
 * Strategy Definitions Repository — database access layer.
 * Enforces immutability of versions once referenced by jobs or deployments.
 */

import { db } from "../../data/drizzle/client";
import {
  strategyDefinitions,
  strategyVersions,
  strategyBacktestJobs,
  strategyDeployments,
} from "../../db/schema";
import { eq, and, desc, count } from "drizzle-orm";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

// ============================================================
// Types
// ============================================================

export interface StrategyDefinitionRow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: string;
  currentDraft: StrategyDefinition;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface StrategyVersionRow {
  id: string;
  strategyId: string;
  userId: string;
  versionNumber: number;
  definition: StrategyDefinition;
  definitionHash: string;
  engineVersion: string;
  indicatorVersion: string;
  schemaVersion: number;
  createdAt: Date;
}

// ============================================================
// Strategy Definitions
// ============================================================

export async function listStrategies(userId: string): Promise<StrategyDefinitionRow[]> {
  const rows = await db
    .select()
    .from(strategyDefinitions)
    .where(and(eq(strategyDefinitions.userId, userId)))
    .orderBy(desc(strategyDefinitions.updatedAt));
  return rows as unknown as StrategyDefinitionRow[];
}

export async function getStrategy(
  userId: string,
  strategyId: string,
): Promise<StrategyDefinitionRow | null> {
  const [row] = await db
    .select()
    .from(strategyDefinitions)
    .where(and(eq(strategyDefinitions.userId, userId), eq(strategyDefinitions.id, strategyId)))
    .limit(1);
  return (row as unknown as StrategyDefinitionRow) ?? null;
}

export async function createStrategy(
  userId: string,
  name: string,
  description: string | undefined,
  definition: StrategyDefinition,
): Promise<StrategyDefinitionRow> {
  const [row] = await db
    .insert(strategyDefinitions)
    .values({
      userId,
      name,
      description: description ?? null,
      status: "DRAFT",
      currentDraft: definition as unknown as Record<string, unknown>,
      schemaVersion: 1,
    })
    .returning();
  return row as unknown as StrategyDefinitionRow;
}

export async function updateStrategyDraft(
  userId: string,
  strategyId: string,
  definition: StrategyDefinition,
): Promise<StrategyDefinitionRow | null> {
  const [row] = await db
    .update(strategyDefinitions)
    .set({
      currentDraft: definition as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(and(
      eq(strategyDefinitions.userId, userId),
      eq(strategyDefinitions.id, strategyId),
      eq(strategyDefinitions.status, "DRAFT"),
    ))
    .returning();
  return (row as unknown as StrategyDefinitionRow) ?? null;
}

export async function updateStrategyStatus(
  userId: string,
  strategyId: string,
  status: "DRAFT" | "VALIDATED" | "ARCHIVED",
): Promise<void> {
  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "ARCHIVED") update.archivedAt = new Date();
  await db
    .update(strategyDefinitions)
    .set(update)
    .where(and(eq(strategyDefinitions.userId, userId), eq(strategyDefinitions.id, strategyId)));
}

// ============================================================
// Strategy Versions
// ============================================================

export async function listVersions(
  userId: string,
  strategyId: string,
): Promise<StrategyVersionRow[]> {
  const rows = await db
    .select()
    .from(strategyVersions)
    .where(and(eq(strategyVersions.userId, userId), eq(strategyVersions.strategyId, strategyId)))
    .orderBy(desc(strategyVersions.versionNumber));
  return rows as unknown as StrategyVersionRow[];
}

export async function getVersion(
  userId: string,
  versionId: string,
): Promise<StrategyVersionRow | null> {
  const [row] = await db
    .select()
    .from(strategyVersions)
    .where(and(eq(strategyVersions.userId, userId), eq(strategyVersions.id, versionId)))
    .limit(1);
  return (row as unknown as StrategyVersionRow) ?? null;
}

export async function createVersion(
  userId: string,
  strategyId: string,
  definition: StrategyDefinition,
  definitionHash: string,
  engineVersion: string,
  indicatorVersion: string,
): Promise<StrategyVersionRow> {
  // Find next version number
  const [countResult] = await db
    .select({ count: count() })
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategyId));
  const nextVersion = (countResult?.count ?? 0) + 1;

  const [row] = await db
    .insert(strategyVersions)
    .values({
      strategyId,
      userId,
      versionNumber: nextVersion,
      definition: definition as unknown as Record<string, unknown>,
      definitionHash,
      engineVersion,
      indicatorVersion,
      schemaVersion: 1,
    })
    .returning();
  return row as unknown as StrategyVersionRow;
}

/**
 * Returns true if this version has been referenced by any job or deployment.
 * Versions that are referenced cannot be mutated.
 */
export async function isVersionReferenced(versionId: string): Promise<boolean> {
  const [jobResult] = await db
    .select({ count: count() })
    .from(strategyBacktestJobs)
    .where(eq(strategyBacktestJobs.strategyVersionId, versionId));
  if ((jobResult?.count ?? 0) > 0) return true;

  const [deployResult] = await db
    .select({ count: count() })
    .from(strategyDeployments)
    .where(eq(strategyDeployments.strategyVersionId, versionId));
  return (deployResult?.count ?? 0) > 0;
}

export async function getVersionByHash(
  strategyId: string,
  hash: string,
): Promise<StrategyVersionRow | null> {
  const [row] = await db
    .select()
    .from(strategyVersions)
    .where(and(
      eq(strategyVersions.strategyId, strategyId),
      eq(strategyVersions.definitionHash, hash),
    ))
    .limit(1);
  return (row as unknown as StrategyVersionRow) ?? null;
}
