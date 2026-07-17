/**
 * Ingestion Engine Orchestrator
 *
 * Coordinates all ingestion pipelines (daily, realtime, weekly, corporate-action).
 * Provides start/stop lifecycle, manual trigger, and event emission.
 *
 * Pipeline modules are imported here; each exports a run function with a
 * consistent interface. New pipelines should be added to the PIPELINES
 * registry and a corresponding entry in the PipelineSource enum.
 */

import { getLogger } from "../../infra/logger";

// ===========================================================================
// Types
// ===========================================================================

export type PipelineState = "idle" | "running" | "error";

export interface PipelineDescriptor {
  /** Unique source key, e.g. "yahoo-history" */
  source: string;
  /** Human-readable label */
  label: string;
  /** Whether this pipeline is auto-started on orchestrator start() */
  autoStart: boolean;
}

export interface PipelineResult {
  runId: string;
  status: "success" | "partial" | "failed";
  symbolsAttempted: number;
  symbolsSucceeded: number;
  symbolsFailed: number;
  durationMs: number;
}

export type OrchestratorEvent =
  | { type: "pipeline:started"; source: string; runId: string; timestamp: Date }
  | { type: "pipeline:completed"; source: string; runId: string; result: PipelineResult; timestamp: Date }
  | { type: "pipeline:failed"; source: string; runId: string; error: string; timestamp: Date }
  | { type: "orchestrator:started"; timestamp: Date }
  | { type: "orchestrator:stopped"; timestamp: Date };

// ===========================================================================
// Pipeline Registry
// ===========================================================================

// Each entry maps a source key to its run function.
// New pipelines: add a module under pipelines/ and register it here.
const PIPELINES: Record<string, {
  label: string;
  autoStart: boolean;
  run: (opts: { symbols: string[]; backfillDays?: number }) => Promise<PipelineResult>;
}> = {};

try {
  const daily = await import("./pipelines/daily-pipeline");
  PIPELINES["yahoo-history"] = {
    label: "Daily OHLCV (Yahoo)",
    autoStart: true,
    run: async (opts) => daily.runDailyPipeline({
      symbols: opts.symbols,
      backfillDays: opts.backfillDays ?? 365,
    }),
  };
} catch (err) {
  console.warn("[orchestrator] Daily pipeline module not available:", err);
}

// Placeholder registrations for pipelines that will be added later:
// PIPELINES["nse-equities"] = { label: "NSE Company Master", autoStart: true, run: ... };
// PIPELINES["realtime"]     = { label: "Real-time Quotes",   autoStart: false, run: ... };
// PIPELINES["weekly"]       = { label: "Weekly Fundamentals", autoStart: true, run: ... };
// PIPELINES["corporate-action"] = { label: "Corporate Actions", autoStart: true, run: ... };

// ===========================================================================
// Event Bus
// ===========================================================================

type EventHandler = (event: OrchestratorEvent) => void;
const eventHandlers: EventHandler[] = [];

function emit(event: OrchestratorEvent): void {
  for (const handler of eventHandlers) {
    try {
      handler(event);
    } catch (err) {
      console.error("[orchestrator] Event handler error:", err);
    }
  }
}

// ===========================================================================
// State
// ===========================================================================

const logger = getLogger("ingestion-orchestrator");

const pipelineStates = new Map<string, PipelineState>();
let orchestratorRunning = false;

// Initialize states
for (const key of Object.keys(PIPELINES)) {
  pipelineStates.set(key, "idle");
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Start all auto-start pipelines. Safe to call multiple times.
 */
export async function start(): Promise<void> {
  if (orchestratorRunning) {
    logger.warn("Orchestrator already running — skipping duplicate start()");
    return;
  }

  orchestratorRunning = true;
  emit({ type: "orchestrator:started", timestamp: new Date() });
  logger.info("Ingestion orchestrator starting");

  for (const [source, config] of Object.entries(PIPELINES)) {
    if (!config.autoStart) continue;
    pipelineStates.set(source, "idle");
    // Auto-start pipelines are launched but not awaited here.
    // They manage their own scheduling internally.
    triggerPipeline(source, []).catch((err) => {
      logger.error({ err, source }, "Auto-start pipeline failed");
      pipelineStates.set(source, "error");
    });
  }
}

/**
 * Graceful shutdown — sets all pipelines to idle.
 * Does not cancel in-flight runs (they finish naturally).
 */
export async function stop(): Promise<void> {
  orchestratorRunning = false;
  for (const key of pipelineStates.keys()) {
    pipelineStates.set(key, "idle");
  }
  emit({ type: "orchestrator:stopped", timestamp: new Date() });
  logger.info("Ingestion orchestrator stopped");
}

/**
 * Trigger a specific pipeline for the given symbols.
 * If symbols is empty, uses the pipeline's default universe.
 */
export async function triggerPipeline(
  source: string,
  symbols: string[]
): Promise<PipelineResult> {
  const config = PIPELINES[source];
  if (!config) {
    throw new Error(`Unknown pipeline source: ${source}. Registered: ${Object.keys(PIPELINES).join(", ")}`);
  }

  const current = pipelineStates.get(source) ?? "idle";
  if (current === "running") {
    throw new Error(`Pipeline ${source} is already running`);
  }

  const runId = `${source}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  pipelineStates.set(source, "running");
  emit({ type: "pipeline:started", source, runId, timestamp: new Date() });
  logger.info({ source, runId, symbols: symbols.length }, "Pipeline started");

  try {
    const result = await config.run({ symbols, backfillDays: 365 });
    pipelineStates.set(source, "idle");
    emit({ type: "pipeline:completed", source, runId, result, timestamp: new Date() });
    logger.info({ source, runId, status: result.status }, "Pipeline completed");
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    pipelineStates.set(source, "error");
    emit({ type: "pipeline:failed", source, runId, error: errorMessage, timestamp: new Date() });
    logger.error({ err, source, runId }, "Pipeline failed");
    throw err;
  }
}

/**
 * Register a custom event handler to receive orchestrator lifecycle events.
 */
export function onPipelineEvent(handler: EventHandler): () => void {
  eventHandlers.push(handler);
  // Return an unsubscribe function
  return () => {
    const idx = eventHandlers.indexOf(handler);
    if (idx >= 0) eventHandlers.splice(idx, 1);
  };
}

/**
 * Get the current state of a pipeline source.
 */
export function getPipelineState(source: string): PipelineState {
  return pipelineStates.get(source) ?? "idle";
}

/**
 * List all registered pipeline sources with their descriptors.
 */
export function listPipelines(): PipelineDescriptor[] {
  return Object.entries(PIPELINES).map(([source, config]) => ({
    source,
    label: config.label,
    autoStart: config.autoStart,
  }));
}
