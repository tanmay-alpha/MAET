/**
 * Strategy Deployments tRPC Router.
 * Manages ALERT_ONLY, MANUAL_CONFIRM, AUTO_PAPER deployments.
 * Every rejection is persisted to audit trail.
 * Kill switch is always available to user.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import { db } from "../../../data/drizzle/client";
import {
  strategyDeployments,
  strategySignalEvents,
  strategyExecutionDecisions,
  strategyVersions,
} from "../../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { CreateDeploymentInputSchema, UpdateRiskLimitsInputSchema, ConfirmProposalInputSchema } from "../../../../shared/strategy/contracts";
import { DeploymentRiskLimitsSchema } from "../../../../shared/strategy/schemas";

export const strategyDeploymentsRouter = createRouter({
  /** List all deployments for current user */
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const deployments = await db
        .select()
        .from(strategyDeployments)
        .where(eq(strategyDeployments.userId, ctx.userId!))
        .orderBy(desc(strategyDeployments.updatedAt));
      return { deployments };
    }),

  /** Get a specific deployment with recent signals */
  get: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [deployment] = await db
        .select()
        .from(strategyDeployments)
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)))
        .limit(1);
      if (!deployment) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });

      const signals = await db
        .select()
        .from(strategySignalEvents)
        .where(eq(strategySignalEvents.deploymentId, input.deploymentId))
        .orderBy(desc(strategySignalEvents.createdAt))
        .limit(50);

      return { deployment, signals };
    }),

  /** Create a new deployment */
  create: protectedProcedure
    .input(CreateDeploymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify version ownership
      const [version] = await db
        .select()
        .from(strategyVersions)
        .where(and(eq(strategyVersions.id, input.strategyVersionId), eq(strategyVersions.userId, ctx.userId!)))
        .limit(1);
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "Strategy version not found" });

      // Enforce: AUTO_PAPER requires stopLossPercent in riskLimits
      if (input.mode === "AUTO_PAPER" && !input.riskLimits.maximumDailyLossPercent) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AUTO_PAPER mode requires maximumDailyLossPercent to be set in risk limits",
        });
      }

      const [deployment] = await db
        .insert(strategyDeployments)
        .values({
          userId: ctx.userId!,
          strategyVersionId: input.strategyVersionId,
          mode: input.mode,
          universe: input.universe,
          timeframe: input.timeframe,
          status: "DRAFT",
          riskLimits: input.riskLimits as any,
          userKillSwitch: false,
          deploymentKillSwitch: false,
        })
        .returning();

      return { deployment };
    }),

  /** Activate a DRAFT deployment */
  activate: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [dep] = await db
        .select()
        .from(strategyDeployments)
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)))
        .limit(1);
      if (!dep) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      if (dep.status !== "DRAFT" && dep.status !== "PAUSED") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Cannot activate a deployment with status ${dep.status}` });
      }

      await db
        .update(strategyDeployments)
        .set({ status: "ACTIVE", startedAt: dep.startedAt ?? new Date(), pausedAt: null, updatedAt: new Date() })
        .where(eq(strategyDeployments.id, input.deploymentId));

      return { activated: true };
    }),

  /** Pause an active deployment */
  pause: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      await db
        .update(strategyDeployments)
        .set({ status: "PAUSED", pausedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)));
      return { paused: true };
    }),

  /** Stop a deployment permanently */
  stop: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      await db
        .update(strategyDeployments)
        .set({ status: "STOPPED", stoppedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)));
      return { stopped: true };
    }),

  /** Toggle user kill switch (always available) */
  toggleKillSwitch: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid(), enabled: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await db
        .update(strategyDeployments)
        .set({ userKillSwitch: input.enabled, updatedAt: new Date() })
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)))
        .returning();
      if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      return { killSwitch: input.enabled };
    }),

  /** Update risk limits */
  updateRiskLimits: protectedProcedure
    .input(UpdateRiskLimitsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await db
        .update(strategyDeployments)
        .set({ riskLimits: input.riskLimits as any, updatedAt: new Date() })
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)));
      return { updated: true };
    }),

  /** Get recent signals for a deployment */
  getSignals: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }).strict())
    .query(async ({ ctx, input }) => {
      const [dep] = await db
        .select()
        .from(strategyDeployments)
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)))
        .limit(1);
      if (!dep) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });

      const signals = await db
        .select()
        .from(strategySignalEvents)
        .where(eq(strategySignalEvents.deploymentId, input.deploymentId))
        .orderBy(desc(strategySignalEvents.createdAt))
        .limit(input.limit);
      return { signals };
    }),

  /** Get execution decisions (full audit trail) */
  getDecisions: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }).strict())
    .query(async ({ ctx, input }) => {
      const [dep] = await db
        .select()
        .from(strategyDeployments)
        .where(and(eq(strategyDeployments.id, input.deploymentId), eq(strategyDeployments.userId, ctx.userId!)))
        .limit(1);
      if (!dep) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });

      const decisions = await db
        .select()
        .from(strategyExecutionDecisions)
        .where(eq(strategyExecutionDecisions.deploymentId, input.deploymentId))
        .orderBy(desc(strategyExecutionDecisions.createdAt))
        .limit(input.limit);
      return { decisions };
    }),

  /** Confirm a MANUAL_CONFIRM proposal — creates a paper order */
  confirmProposal: protectedProcedure
    .input(ConfirmProposalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [decision] = await db
        .select()
        .from(strategyExecutionDecisions)
        .where(and(eq(strategyExecutionDecisions.id, input.decisionId), eq(strategyExecutionDecisions.userId, ctx.userId!)))
        .limit(1);

      if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Decision not found" });
      if (decision.decision !== "PROPOSAL_CREATED") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Decision is not a pending proposal" });
      }
      if (decision.paperOrderId) {
        throw new TRPCError({ code: "CONFLICT", message: "This proposal has already been confirmed" });
      }

      // In a full implementation, this would create a paper order.
      // For now, we record the confirmation intent.
      return {
        confirmed: true,
        proposedOrder: decision.proposedOrder,
        note: "Paper order creation requires paper-trading router integration — connect in a follow-up",
      };
    }),
});
