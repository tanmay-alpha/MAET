/**
 * Deterministic hashing for research run reports: canonical JSON, SHA-256 digests, the candle
 * fingerprint a backtest run records, and the server revision that ran it.
 */

import { createHash } from "node:crypto";
import type { Candle } from "@shared/types";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * JSON with object keys sorted at every depth, so equal values always serialise identically
 * regardless of key insertion order (Postgres jsonb reorders keys). Array order is kept.
 * Non-finite numbers throw: JSON would silently turn them into null and hide a broken metric.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value}`);
  }
}

/** How candleFingerprint serialises each bar before hashing; recorded next to the digest. */
export const CANDLE_FINGERPRINT_CANONICAL_FORM = "ts:open:high:low:close:volume per bar, oldest first, joined by |";

/**
 * SHA-256 over the bars a run consumed, oldest first, in the serialisation the strategy engine
 * hashes for its own `dataHash` (server/domain/strategy/runner-v3.ts computeDataHash), whose value
 * is the first 16 hex characters of this digest.
 */
export function candleFingerprint(candles: readonly Candle[]): string {
  const sorted = [...candles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return sha256Hex(sorted.map((c) => `${c.ts}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume ?? 0}`).join("|"));
}

/** Commit the running server was built from: GIT_SHA, else RENDER_GIT_COMMIT, else "unknown". */
export function serverGitCommit(env: NodeJS.ProcessEnv = process.env): string {
  return env.GIT_SHA || env.RENDER_GIT_COMMIT || "unknown";
}
