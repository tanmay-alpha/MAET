import type { WorldSource } from "./contracts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface FreshnessPolicy {
  /** How long a successful read is current; the server cache and the browser revalidate after it. */
  readonly ttlMs: number;
  /** Past this age a payload is dropped rather than shown, however long its source stays down. */
  readonly maxAgeMs: number;
}

/**
 * One freshness policy per source, shared by the server caches and the browser fallback so the
 * two never disagree about when data is current. Event feeds describe what is happening now, so
 * they are dropped after six hours; headlines stay readable for a day; World Bank series change
 * once a year.
 */
export const WORLD_FRESHNESS: Readonly<Record<WorldSource, FreshnessPolicy>> = {
  USGS: { ttlMs: MINUTE, maxAgeMs: 6 * HOUR },
  "NASA EONET": { ttlMs: 5 * MINUTE, maxAgeMs: 6 * HOUR },
  GDELT: { ttlMs: 15 * MINUTE, maxAgeMs: 24 * HOUR },
  "World Bank": { ttlMs: 24 * HOUR, maxAgeMs: 7 * 24 * HOUR },
};
