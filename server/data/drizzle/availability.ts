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

/**
 * Permission for one guarded operation. `generation` identifies the open
 * period it started in; only the half-open trial of the current generation
 * may close the breaker.
 */
export type DatabaseAttempt = { generation: number; trial: boolean };

/** Marker of when a health probe started (the breaker generation at that time). */
export type DatabaseProbeTicket = { generation: number };

/** Probe failures without a connection error (e.g. timeouts on a busy pool) needed to open. */
const PROBE_FAILURES_TO_OPEN = 3;

export class DatabaseCircuitBreaker {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private openedAt: number | undefined;
  private trialStartedAt: number | undefined;
  /** Incremented every time the breaker opens. */
  private generation = 0;
  private consecutiveProbeFailures = 0;

  constructor(options: DatabaseCircuitBreakerOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  state(): DatabaseBreakerState {
    if (this.openedAt === undefined) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  /**
   * Permission to use the database now, or undefined while open. In half-open
   * state the first caller gets the single trial; a trial that never reports
   * back is replaced after another cooldown.
   */
  tryAcquire(): DatabaseAttempt | undefined {
    const state = this.state();
    if (state === "closed") return { generation: this.generation, trial: false };
    if (state === "open") return undefined;
    const now = this.now();
    if (this.trialStartedAt !== undefined && now - this.trialStartedAt < this.cooldownMs) return undefined;
    this.trialStartedAt = now;
    return { generation: this.generation, trial: true };
  }

  /**
   * Only the current half-open trial closes the breaker: a slow query that
   * started before the breaker opened says nothing about the database now.
   */
  recordSuccess(attempt: DatabaseAttempt): void {
    if (attempt.trial && attempt.generation === this.generation && this.openedAt !== undefined) this.close();
  }

  /**
   * Opens on connection-class errors from any operation. Any other error from
   * the current trial proves the server answered, so it closes the breaker.
   */
  recordFailure(error: unknown, attempt?: DatabaseAttempt): void {
    if (isConnectionError(error)) this.open();
    else if (attempt) this.recordSuccess(attempt);
  }

  startProbe(): DatabaseProbeTicket {
    return { generation: this.generation };
  }

  /**
   * Health probe (`select 1`) outcome. A connection error opens the breaker at
   * once; other failures (a probe timeout on a busy pool) open it only after
   * PROBE_FAILURES_TO_OPEN in a row. A success closes it if the probe started
   * after the breaker last opened.
   */
  recordProbe(ticket: DatabaseProbeTicket, ok: boolean, error?: unknown): void {
    if (ok) {
      this.consecutiveProbeFailures = 0;
      if (ticket.generation === this.generation && this.openedAt !== undefined) this.close();
      return;
    }
    this.consecutiveProbeFailures++;
    if (isConnectionError(error) || this.consecutiveProbeFailures >= PROBE_FAILURES_TO_OPEN) this.open();
  }

  private open(): void {
    this.generation++;
    this.openedAt = this.now();
    this.trialStartedAt = undefined;
  }

  private close(): void {
    this.openedAt = undefined;
    this.trialStartedAt = undefined;
    this.consecutiveProbeFailures = 0;
  }
}

/** Process-wide breaker shared by guarded read paths and the health probe. */
export const databaseBreaker = new DatabaseCircuitBreaker();
const breaker = databaseBreaker;

/** Whether guarded reads currently use the database (does not consume the half-open trial). */
export function isDatabaseAvailable(): boolean {
  return breaker.state() !== "open";
}

/** Reports a database error seen outside withOptionalDatabase; opens on connection errors. */
export function recordDatabaseFailure(error: unknown): void {
  breaker.recordFailure(error);
}

export function databaseBreakerState(): DatabaseBreakerState {
  return breaker.state();
}

/** Test-only: closes the process-wide breaker. */
export function resetDatabaseBreakerForTests(): void {
  breaker.recordProbe(breaker.startProbe(), true);
}

/**
 * Runs an optional database operation of a read path through the breaker:
 * fails fast with DatabaseUnavailableError while open, and records the
 * outcome. Callers must have a non-database fallback.
 */
export async function withOptionalDatabase<T>(operation: () => Promise<T>): Promise<T> {
  const attempt = breaker.tryAcquire();
  if (!attempt) throw new DatabaseUnavailableError();
  try {
    const result = await operation();
    breaker.recordSuccess(attempt);
    return result;
  } catch (error) {
    breaker.recordFailure(error, attempt);
    throw error;
  }
}
