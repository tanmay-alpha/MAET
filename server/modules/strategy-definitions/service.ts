/**
 * Strategy Definitions Service — business logic layer.
 * Handles creation, validation, versioning, import/export, and archival.
 * Deterministic SHA-256 hash for reproducibility tracking.
 */

import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import * as repo from "./repository";
import { validateAst, canonicalDefinitionJson } from "../../../shared/strategy/ast";
import { StrategyDefinitionSchema } from "../../../shared/strategy/schemas";
import {
  STRATEGY_ENGINE_VERSION,
  INDICATOR_ENGINE_VERSION,
  STRATEGY_SCHEMA_VERSION,
} from "../../../shared/strategy/version";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

// ============================================================
// Create
// ============================================================

export async function createStrategy(
  userId: string,
  name: string,
  description: string | undefined,
  definition: StrategyDefinition,
) {
  const validation = validateAst(definition);
  if (!validation.valid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Strategy definition is invalid: ${validation.errors.map((e) => e.message).join("; ")}`,
    });
  }
  return repo.createStrategy(userId, name, description, definition);
}

// ============================================================
// Update draft
// ============================================================

export async function updateDraft(
  userId: string,
  strategyId: string,
  definition: StrategyDefinition,
) {
  const existing = await repo.getStrategy(userId, strategyId);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
  }
  if (existing.status !== "DRAFT") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Only DRAFT strategies can be updated. Duplicate the strategy to create a new draft.",
    });
  }
  const updated = await repo.updateStrategyDraft(userId, strategyId, definition);
  if (!updated) {
    throw new TRPCError({ code: "CONFLICT", message: "Update failed — strategy may have changed status" });
  }
  return updated;
}

// ============================================================
// Validate (without persisting)
// ============================================================

export function validateStrategy(definition: StrategyDefinition) {
  const parseResult = StrategyDefinitionSchema.safeParse(definition);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      warnings: [],
      conditionCount: 0,
      maxDepthReached: 0,
    };
  }
  return validateAst(parseResult.data as StrategyDefinition);
}

// ============================================================
// Create version (frozen snapshot)
// ============================================================

export async function createVersion(userId: string, strategyId: string) {
  const strategy = await repo.getStrategy(userId, strategyId);
  if (!strategy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
  }

  const definition = strategy.currentDraft;
  const validation = validateAst(definition);
  if (!validation.valid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot version an invalid strategy: ${validation.errors.map((e) => e.message).join("; ")}`,
    });
  }

  const canonicalJson = canonicalDefinitionJson(definition);
  const definitionHash = createHash("sha256").update(canonicalJson).digest("hex");

  // Check if identical version already exists
  const existing = await repo.getVersionByHash(strategyId, definitionHash);
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `An identical version (v${existing.versionNumber}) already exists for this strategy definition.`,
    });
  }

  const version = await repo.createVersion(
    userId,
    strategyId,
    definition,
    definitionHash,
    STRATEGY_ENGINE_VERSION,
    INDICATOR_ENGINE_VERSION,
  );

  // Move strategy to VALIDATED once first version created
  if (strategy.status === "DRAFT") {
    await repo.updateStrategyStatus(userId, strategyId, "VALIDATED");
  }

  return version;
}

// ============================================================
// Duplicate
// ============================================================

export async function duplicateStrategy(userId: string, strategyId: string) {
  const strategy = await repo.getStrategy(userId, strategyId);
  if (!strategy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
  }
  const copyName = `${strategy.name} (copy)`;
  return repo.createStrategy(userId, copyName, strategy.description ?? undefined, strategy.currentDraft);
}

// ============================================================
// Archive
// ============================================================

export async function archiveStrategy(userId: string, strategyId: string) {
  const strategy = await repo.getStrategy(userId, strategyId);
  if (!strategy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
  }
  await repo.updateStrategyStatus(userId, strategyId, "ARCHIVED");
  return { archived: true };
}

// ============================================================
// Export
// ============================================================

export async function exportStrategy(userId: string, strategyId: string): Promise<string> {
  const strategy = await repo.getStrategy(userId, strategyId);
  if (!strategy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
  }
  const versions = await repo.listVersions(userId, strategyId);

  const exportPayload = {
    exportFormatVersion: 1,
    strategySchemaVersion: STRATEGY_SCHEMA_VERSION,
    engineVersion: STRATEGY_ENGINE_VERSION,
    name: strategy.name,
    description: strategy.description,
    currentDraft: strategy.currentDraft,
    versions: versions.map((v) => ({
      versionNumber: v.versionNumber,
      definition: v.definition,
      definitionHash: v.definitionHash,
      engineVersion: v.engineVersion,
      indicatorVersion: v.indicatorVersion,
      createdAt: v.createdAt,
    })),
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(exportPayload, null, 2);
}

// ============================================================
// Import
// ============================================================

export async function importStrategy(userId: string, payload: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid JSON in import payload" });
  }

  if (!parsed.currentDraft || typeof parsed.currentDraft !== "object") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Import payload missing currentDraft" });
  }

  const parseResult = StrategyDefinitionSchema.safeParse(parsed.currentDraft);
  if (!parseResult.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Imported strategy definition is invalid: ${parseResult.error.errors.map((e) => e.message).join("; ")}`,
    });
  }

  const name = typeof parsed.name === "string" ? `${parsed.name} (imported)` : "Imported Strategy";
  const description = typeof parsed.description === "string" ? parsed.description : undefined;

  return repo.createStrategy(userId, name, description, parseResult.data as StrategyDefinition);
}
