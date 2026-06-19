import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "IDEMPOTENT_REPLAY",
  "UPSTREAM_DEGRADED",
  "UPSTREAM_PERMANENT",
  "VALIDATION_FAILED",
  "MARKET_CLOSED",
  "INSUFFICIENT_BUYING_POWER",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export class AppError extends Error {
  code: ErrorCode;
  data?: unknown;
  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "AppError";
  }
}

// Typed upstream error subclasses shared by all data/sources/* modules.
// Defining them here keeps sibling data/* files decoupled from one another.
export class UpstreamDegradedError extends AppError {
  constructor(message: string, data?: unknown) {
    super("UPSTREAM_DEGRADED", message, data);
    this.name = "UpstreamDegradedError";
  }
}

export class UpstreamPermanentError extends AppError {
  constructor(message: string, data?: unknown) {
    super("UPSTREAM_PERMANENT", message, data);
    this.name = "UpstreamPermanentError";
  }
}
