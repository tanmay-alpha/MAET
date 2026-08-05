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

  /** Confirm a MANUAL_CONFIRM proposal — creates a real paper order through canonical paper trading service */
  confirmProposal: protectedProcedure
    .input(ConfirmProposalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [decision] = await db
        .select()
        .from(strategyExecutionDecisions)
        .where(and(eq(strategyExecutionDecisions.id, input.decisionId), eq(strategyExecutionDecisions.userId, ctx.userId!)))
        .limit(1);

      if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Execution decision not found" });
      if (decision.decision !== "PROPOSED" && decision.decision !== "PROPOSAL_CREATED") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Decision is not a pending proposal" });
      }
      if (decision.paperOrderId) {
        throw new TRPCError({ code: "CONFLICT", message: "This proposal has already been confirmed and executed" });
      }

      // Fetch signal event
      const [signal] = await db
        .select()
        .from(strategySignalEvents)
        .where(eq(strategySignalEvents.id, decision.signalId))
        .limit(1);

      if (!signal) throw new TRPCError({ code: "NOT_FOUND", message: "Associated signal event not found" });

      const proposed = (decision.proposedOrder as any) ?? {};
      const symbol = proposed.symbol ?? signal.symbol;
      const side = (proposed.side ?? proposed.action) as "BUY" | "SELL";
      const qty = Number(proposed.quantity ?? proposed.qty ?? 1);

      if (!symbol || !side || isNaN(qty) || qty <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Malformed proposed order payload in execution decision" });
      }

      if (proposed.expiresAt && new Date(proposed.expiresAt) < new Date()) {
        await db
          .update(strategyExecutionDecisions)
          .set({ decision: "EXPIRED", reasonCode: "PROPOSAL_EXPIRED" })
          .where(eq(strategyExecutionDecisions.id, decision.id));
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Proposal has expired" });
      }

      // Load deployment and re-run risk gate
      const [deploymentRow] = await db
        .select()
        .from(strategyDeployments)
        .where(eq(strategyDeployments.id, decision.deploymentId))
        .limit(1);

      if (!deploymentRow) throw new TRPCError({ code: "NOT_FOUND", message: "Associated deployment not found" });

      const { evaluateRiskGate } = await import("../../../workers/strategy-evaluator");
      const { PaperTradingService } = await import("../../../modules/paper-trading/service");
      const service = new PaperTradingService();
      const paperState = await service.getState({ userId: ctx.userId! });

      const riskRes = evaluateRiskGate(
        deploymentRow,
        { type: side === "BUY" ? "ENTRY" : "EXIT", symbol },
        Number(paperState.account.cashBalance),
        paperState.positions.filter((p: any) => p.totalShares > 0).length,
        0,
      );


      if (!riskRes.passed) {
        await db
          .update(strategyExecutionDecisions)
          .set({ decision: "REJECTED", reasonCode: riskRes.rejectReason })
          .where(eq(strategyExecutionDecisions.id, decision.id));
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Risk gate check failed: ${riskRes.rejectReason}` });
      }

      // Execute canonical paper order using PaperTradingService instance
      const orderRes = await service.placeOrder({
        userId: ctx.userId!,
        command: {
          symbol,
          side,
          type: "MARKET",
          qty,
          idempotencyKey: `manconfirm-${decision.id}`,
        },
      });

      await db
        .update(strategyExecutionDecisions)
        .set({
          decision: "EXECUTED",
          paperOrderId: orderRes.order.id,
        })
        .where(eq(strategyExecutionDecisions.id, decision.id));

      return {
        confirmed: true,
        order: orderRes.order,
      };
    }),

});
