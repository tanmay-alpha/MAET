/**
 * Paper Trading — single authoritative error definition source.
 *
 * Every error class extends PaperTradingError and contains:
 * - code: string
 * - message: string
 * - details?: unknown
 * - cause?: unknown
 */

export class PaperTradingError extends Error {
  readonly code: string;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(
    message: string,
    code = "PAPER_TRADING_ERROR",
    details?: unknown,
    cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export class PaperValidationError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_VALIDATION_ERROR", details, cause);
  }
}

export class PaperAuthenticationError extends PaperTradingError {
  constructor(message = "Authentication required for paper trading", details?: unknown, cause?: unknown) {
    super(message, "PAPER_AUTHENTICATION_ERROR", details, cause);
  }
}

export class PaperAccountLockedError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_ACCOUNT_LOCKED", details, cause);
  }
}

export class PaperInsufficientMarginError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_INSUFFICIENT_MARGIN", details, cause);
  }
}

export class PaperQuoteRejectedError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_QUOTE_REJECTED", details, cause);
  }
}

export class PaperOrderNotFoundError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_ORDER_NOT_FOUND", details, cause);
  }
}

export class PaperOrderConflictError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_ORDER_CONFLICT", details, cause);
  }
}

export class PaperIdempotencyConflictError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_IDEMPOTENCY_CONFLICT", details, cause);
  }
}

export class PaperConcurrencyError extends PaperTradingError {
  constructor(message = "A concurrent transaction modified paper trading state. Retry operation.", details?: unknown, cause?: unknown) {
    super(message, "PAPER_CONCURRENCY_ERROR", details, cause);
  }
}

export class PaperPersistenceError extends PaperTradingError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, "PAPER_PERSISTENCE_ERROR", details, cause);
  }
}

/**
 * Extract human-readable error message safely from unknown thrown errors.
 */
export function getPaperTradingErrorMessage(error: unknown): string {
  if (error instanceof PaperTradingError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected paper trading error occurred.";
}

/**
 * Check if a thrown error represents a PostgreSQL retryable serialization/deadlock failure (40001 or 40P01).
 */
export function isRetryableDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errObj = error as Record<string, unknown>;
  const code = String(errObj.code || "");
  if (code === "40001" || code === "40P01") {
    return true;
  }

  if (errObj.cause && typeof errObj.cause === "object") {
    const causeCode = String((errObj.cause as Record<string, unknown>).code || "");
    if (causeCode === "40001" || causeCode === "40P01") {
      return true;
    }
  }

  return false;
}
