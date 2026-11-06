/**
 * Database availability circuit breaker.
 *
 * While the database is unreachable, every query waits for postgres.js's
 * connect_timeout (10s) before failing, so read endpoints that fall back to
 * another source (Yahoo, the NSE master) took 11–30s. After a
 * connection-class failure the breaker opens: guarded reads fail at once
 * for a cooldown, then one trial request is let through (half-open) and
 * its outcome closes or re-opens the breaker.
 *
 * Only best-effort read paths consult it. Writes that must succeed (paper
 * trading) keep talking to the database and fail loudly.
 */

export type DatabaseBreakerState = "closed" | "open" | "half-open";

const DEFAULT_COOLDOWN_MS = 30_000;

// Node/postgres.js connection failures and Postgres SQLSTATEs meaning the
// server is unreachable or went away (class 08 connection exceptions,
// 57P01-57P03 shutdown/cannot-connect-now).
const CONNECTION_ERROR_CODES: Record<string, true> = {
  ECONNREFUSED: true,
  ENOTFOUND: true,
  ETIMEDOUT: true,
  ECONNRESET: true,
  EAI_AGAIN: true,
  EHOSTUNREACH: true,
  ENETUNREACH: true,
  EPIPE: true,
  CONNECT_TIMEOUT: true,
  CONNECTION_CLOSED: true,
  CONNECTION_ENDED: true,
  CONNECTION_DESTROYED: true,
  "57P01": true,
  "57P02": true,
  "57P03": true,
};

export function isConnectionError(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") return false;
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && (Object.hasOwn(CONNECTION_ERROR_CODES, code) || /^08[0-9A-Z]{3}$/.test(code))) {
      return true;
    }
    if (typeof message === "string" && /\b(CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b/.test(message)) {
      return true;
    }
    current = cause;
  }
  return false;
}

export class DatabaseUnavailableError extends Error {
  override name = "DatabaseUnavailableError";
  constructor() {
    super("database unavailable (circuit open)");
  }
}

export type DatabaseCircuitBreakerOptions = {
  cooldownMs?: number;
  now?: () => number;
};

export class DatabaseCircuitBreaker {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private openedAt: number | undefined;
  private trialStartedAt: number | undefined;

  constructor(options: DatabaseCircuitBreakerOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  state(): DatabaseBreakerState {
    if (this.openedAt === undefined) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  /**
   * Whether a guarded read may use the database now. In half-open state the
   * first caller gets the single trial; a trial that never reports back is
   * replaced after another cooldown.
   */
  isAvailable(): boolean {
    const state = this.state();
    if (state === "closed") return true;
    if (state === "open") return false;
    const now = this.now();
    if (this.trialStartedAt !== undefined && now - this.trialStartedAt < this.cooldownMs) return false;
    this.trialStartedAt = now;
    return true;
  }

  recordSuccess(): void {
    this.openedAt = undefined;
    this.trialStartedAt = undefined;
  }

  /** Opens on connection-class errors; any other error proves the server answered. */
  recordFailure(error: unknown): void {
    if (isConnectionError(error)) this.open();
    else if (this.openedAt !== undefined) this.recordSuccess();
  }

  /** The health probe (`select 1`) is authoritative in both directions. */
  recordProbe(ok: boolean): void {
    if (ok) this.recordSuccess();
    else this.open();
  }

  private open(): void {
    this.openedAt = this.now();
    this.trialStartedAt = undefined;
  }
}

/** Process-wide breaker shared by guarded read paths and the health probe. */
export const databaseBreaker = new DatabaseCircuitBreaker();
const breaker = databaseBreaker;

export function isDatabaseAvailable(): boolean {
  return breaker.isAvailable();
}

export function recordDatabaseFailure(error: unknown): void {
  breaker.recordFailure(error);
}

export function recordDatabaseSuccess(): void {
  breaker.recordSuccess();
}

export function recordDatabaseProbe(ok: boolean): void {
  breaker.recordProbe(ok);
}

export function databaseBreakerState(): DatabaseBreakerState {
  return breaker.state();
}

/**
 * Runs an optional database operation of a read path through the breaker:
 * fails fast with DatabaseUnavailableError while open, and records the
 * outcome. Callers must have a non-database fallback.
 */
export async function withOptionalDatabase<T>(operation: () => Promise<T>): Promise<T> {
  if (!breaker.isAvailable()) throw new DatabaseUnavailableError();
  try {
    const result = await operation();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure(error);
    throw error;
  }
}
