/**
 * Input contracts for Strategy Lab API endpoints.
 * Zod-derived TypeScript types for tRPC procedure inputs.
 */

import { z } from "zod";
import {
  StrategyDefinitionSchema,
  DeploymentModeSchema,
  DeploymentRiskLimitsSchema,
  SweepParameterSchema,
  WalkForwardModeSchema,
} from "./schemas";

// ============================================================
// Strategy Definition Contracts
// ============================================================

export const CreateStrategyInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  definition: StrategyDefinitionSchema,
});
export type CreateStrategyInput = z.infer<typeof CreateStrategyInputSchema>;

export const UpdateStrategyDraftInputSchema = z.object({
  strategyId: z.string().uuid(),
  definition: StrategyDefinitionSchema,
});
export type UpdateStrategyDraftInput = z.infer<typeof UpdateStrategyDraftInputSchema>;

export const CreateVersionInputSchema = z.object({
  strategyId: z.string().uuid(),
});
export type CreateVersionInput = z.infer<typeof CreateVersionInputSchema>;

export const ExportStrategyInputSchema = z.object({
  strategyId: z.string().uuid(),
});
export type ExportStrategyInput = z.infer<typeof ExportStrategyInputSchema>;

export const ImportStrategyInputSchema = z.object({
  payload: z.string().min(1).max(500_000), // JSON string, max 500 KB
});
export type ImportStrategyInput = z.infer<typeof ImportStrategyInputSchema>;

// ============================================================
// Backtest Job Contracts
// ============================================================

export const CreateBacktestJobInputSchema = z.object({
  strategyVersionId: z.string().uuid(),
  symbolOrUniverse: z.string().min(1).max(200),
  timeframe: z.string().min(1).max(10),
  from: z.string().datetime(),
  to: z.string().datetime(),
  overrideCapital: z.number().positive().optional(),
  benchmarkSymbol: z.string().optional(),
  runId: z.string().uuid().optional(), // idempotency
});
export type CreateBacktestJobInput = z.infer<typeof CreateBacktestJobInputSchema>;

// ============================================================
// Parameter Sweep Contracts
// ============================================================

export const CreateSweepInputSchema = z.object({
  strategyId: z.string().uuid(),
  parameters: z.array(SweepParameterSchema).min(1).max(6),
  symbolOrUniverse: z.string().min(1),
  timeframe: z.string().min(1).max(10),
  from: z.string().datetime(),
  to: z.string().datetime(),
});
export type CreateSweepInput = z.infer<typeof CreateSweepInputSchema>;

// ============================================================
// Walk-Forward Contracts
// ============================================================

export const CreateWalkForwardInputSchema = z.object({
  strategyId: z.string().uuid(),
  mode: WalkForwardModeSchema,
  parameters: z.array(SweepParameterSchema).min(1).max(6),
  symbol: z.string().min(1),
  timeframe: z.string().min(1).max(10),
  from: z.string().datetime(),
  to: z.string().datetime(),
  trainingWindowDays: z.number().int().min(30),
  validationWindowDays: z.number().int().min(14),
  minimumWindows: z.number().int().min(2).max(20),
});
export type CreateWalkForwardInput = z.infer<typeof CreateWalkForwardInputSchema>;

// ============================================================
// Deployment Contracts
// ============================================================

export const CreateDeploymentInputSchema = z.object({
  strategyVersionId: z.string().uuid(),
  mode: DeploymentModeSchema,
  universe: z.string().min(1),
  timeframe: z.string().min(1).max(10),
  riskLimits: DeploymentRiskLimitsSchema,
});
export type CreateDeploymentInput = z.infer<typeof CreateDeploymentInputSchema>;

export const UpdateRiskLimitsInputSchema = z.object({
  deploymentId: z.string().uuid(),
  riskLimits: DeploymentRiskLimitsSchema,
});
export type UpdateRiskLimitsInput = z.infer<typeof UpdateRiskLimitsInputSchema>;

export const ConfirmProposalInputSchema = z.object({
  decisionId: z.string().uuid(),
});
export type ConfirmProposalInput = z.infer<typeof ConfirmProposalInputSchema>;

// ============================================================
// Bar Replay Contracts
// ============================================================

export const CreateReplayInputSchema = z.object({
  symbol: z.string().min(1).max(20),
  timeframe: z.string().min(1).max(10),
  startTimestamp: z.string().datetime(),
  initialCapital: z.number().positive().finite().optional(),
});
export type CreateReplayInput = z.infer<typeof CreateReplayInputSchema>;
