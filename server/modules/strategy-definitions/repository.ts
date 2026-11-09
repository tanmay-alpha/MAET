/**
 * Strategy Definitions Repository — database access layer.
 * Enforces immutability of versions once referenced by jobs or deployments.
 */

import { db } from "../../data/drizzle/client";
import {
  strategyDefinitions,
  strategyVersions,
} from "../../db/schema";
import { eq, and, desc, max } from "drizzle-orm";
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

export type CreateVersionResult =
  | { created: StrategyVersionRow }
  | { duplicateOf: StrategyVersionRow };

/**
 * Assigns the next version number and inserts the version atomically. The
 * strategy row is locked for the transaction, so concurrent calls for one
 * strategy are serialised: each sees the previous call's version, numbers stay
 * consecutive, and an identical definition is reported as a duplicate instead
 * of failing on the (strategy_id, definition_hash) unique index. Numbering uses
 * max(version_number), not count(*), so it stays correct if a version row is removed.
 */
export async function createVersion(
  userId: string,
  strategyId: string,
  definition: StrategyDefinition,
  definitionHash: string,
  engineVersion: string,
  indicatorVersion: string,
): Promise<CreateVersionResult> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: strategyDefinitions.id })
      .from(strategyDefinitions)
      .where(and(eq(strategyDefinitions.id, strategyId), eq(strategyDefinitions.userId, userId)))
      .for("update");

    const [duplicate] = await tx
      .select()
      .from(strategyVersions)
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.definitionHash, definitionHash)))
      .limit(1);
    if (duplicate) return { duplicateOf: duplicate as unknown as StrategyVersionRow };

    const [latest] = await tx
      .select({ latest: max(strategyVersions.versionNumber) })
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId));

    const [row] = await tx
      .insert(strategyVersions)
      .values({
        strategyId,
        userId,
        versionNumber: (latest?.latest ?? 0) + 1,
        definition: definition as unknown as Record<string, unknown>,
        definitionHash,
        engineVersion,
        indicatorVersion,
        schemaVersion: 1,
      })
      .returning();
    return { created: row as unknown as StrategyVersionRow };
  });
}
