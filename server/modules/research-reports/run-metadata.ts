/**
 * Reproducibility metadata a backtest job records when it completes
 * (strategy_backtest_jobs.reproducibility_metadata), written by server/workers/backtest-worker.ts in
 * the transaction that stores its results. Jobs completed before it was recorded have none: their
 * reports show these fields as not recorded rather than guessing them afterwards.
 */

import type { Candle } from "@shared/types";
import { candleFingerprint, CANDLE_FINGERPRINT_CANONICAL_FORM, serverGitCommit } from "./hashing";

export const RUN_METADATA_SCHEMA = "maet.backtest-run-metadata/v1";

export interface RunMetadata {
  schema: typeof RUN_METADATA_SCHEMA;
  /** Commit of the server that ran the job; "unknown" when its environment did not say. */
  gitCommitSha: string;
  engineVersion: string;
  indicatorVersion: string;
  feeModelVersion: string;
  symbols: string[];
  candleCount: number;
  firstCandleTs: string | null;
  lastCandleTs: string | null;
  candleFingerprint: { algorithm: "sha256"; canonicalForm: string; value: string };
}

export function buildRunMetadata(input: {
  symbols: string[];
  candles: readonly Candle[];
  engineVersion: string;
  indicatorVersion: string;
  feeModelVersion: string;
  env?: NodeJS.ProcessEnv;
}): RunMetadata {
  let first = Infinity;
  let last = -Infinity;
  for (const c of input.candles) {
    const t = new Date(c.ts).getTime();
    if (t < first) first = t;
    if (t > last) last = t;
  }
  const bounded = input.candles.length > 0;
  return {
    schema: RUN_METADATA_SCHEMA,
    gitCommitSha: serverGitCommit(input.env),
    engineVersion: input.engineVersion,
    indicatorVersion: input.indicatorVersion,
    feeModelVersion: input.feeModelVersion,
    symbols: [...input.symbols],
    candleCount: input.candles.length,
    firstCandleTs: bounded ? new Date(first).toISOString() : null,
    lastCandleTs: bounded ? new Date(last).toISOString() : null,
    candleFingerprint: { algorithm: "sha256", canonicalForm: CANDLE_FINGERPRINT_CANONICAL_FORM, value: candleFingerprint(input.candles) },
  };
}

/** The stored metadata when it is a v1 record, else null (never recorded, or an unknown shape). */
export function parseRunMetadata(value: unknown): RunMetadata | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<RunMetadata>;
  if (m.schema !== RUN_METADATA_SCHEMA) return null;
  if (typeof m.gitCommitSha !== "string" || typeof m.candleCount !== "number" || typeof m.candleFingerprint?.value !== "string") return null;
  return m as RunMetadata;
}
