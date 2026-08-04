/**
 * Strategy Definitions tRPC Router.
 * Handles list, get, create, update, validate, version, duplicate, archive, export, import.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import * as service from "../../../modules/strategy-definitions/service";
import * as repo from "../../../modules/strategy-definitions/repository";
import { StrategyDefinitionSchema } from "../../../../shared/strategy/schemas";
import { CreateVersionInputSchema, ExportStrategyInputSchema, ImportStrategyInputSchema } from "../../../../shared/strategy/contracts";

export const strategyDefinitionsRouter = createRouter({
  /** List all strategies for the current user */
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const strategies = await repo.listStrategies(ctx.userId!);
      return { strategies };
    }),

  /** Get single strategy with versions */
  get: protectedProcedure
    .input(z.object({ strategyId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const strategy = await repo.getStrategy(ctx.userId!, input.strategyId);
      if (!strategy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
      }
      const versions = await repo.listVersions(ctx.userId!, input.strategyId);
      return { strategy, versions };
    }),

  /** Get a specific version */
  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const version = await repo.getVersion(ctx.userId!, input.versionId);
      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Strategy version not found" });
      }
      return { version };
    }),

  /** Create a new strategy with initial draft */
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      definition: StrategyDefinitionSchema,
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const strategy = await service.createStrategy(
        ctx.userId!,
        input.name,
        input.description,
        input.definition as any,
      );
      return { strategy };
    }),

  /** Update the current draft of a DRAFT-status strategy */
  updateDraft: protectedProcedure
    .input(z.object({
      strategyId: z.string().uuid(),
      definition: StrategyDefinitionSchema,
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const strategy = await service.updateDraft(
        ctx.userId!,
        input.strategyId,
        input.definition as any,
      );
      return { strategy };
    }),

  /** Validate a definition without persisting */
  validate: protectedProcedure
    .input(z.object({ definition: StrategyDefinitionSchema }).strict())
    .mutation(({ input }) => {
      const result = service.validateStrategy(input.definition as any);
      return result;
    }),

  /** Create an immutable version from the current draft */
  createVersion: protectedProcedure
    .input(CreateVersionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const version = await service.createVersion(ctx.userId!, input.strategyId);
      return { version };
    }),

  /** Duplicate a strategy as a new DRAFT */
  duplicate: protectedProcedure
    .input(z.object({ strategyId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const strategy = await service.duplicateStrategy(ctx.userId!, input.strategyId);
      return { strategy };
    }),

  /** Archive a strategy */
  archive: protectedProcedure
    .input(z.object({ strategyId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      return service.archiveStrategy(ctx.userId!, input.strategyId);
    }),

  /** Export strategy as a portable JSON string */
  export: protectedProcedure
    .input(ExportStrategyInputSchema)
    .query(async ({ ctx, input }) => {
      const payload = await service.exportStrategy(ctx.userId!, input.strategyId);
      return { payload };
    }),

  /** Import strategy from a portable JSON string */
  import: protectedProcedure
    .input(ImportStrategyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const strategy = await service.importStrategy(ctx.userId!, input.payload);
      return { strategy };
    }),
});
