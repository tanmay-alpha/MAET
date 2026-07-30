import { describe, test, expect } from "bun:test";
import { toTrpcError } from "./paper-trading";
import {
  PaperValidationError,
  PaperAuthenticationError,
  PaperOrderNotFoundError,
  PaperQuoteRejectedError,
  PaperInsufficientMarginError,
  PaperAccountLockedError,
  PaperOrderConflictError,
  PaperIdempotencyConflictError,
  PaperConcurrencyError,
} from "../../../modules/paper-trading/errors";

describe("tRPC Error Mapping", () => {
  test("maps PaperValidationError to BAD_REQUEST", () => {
    const err = toTrpcError(new PaperValidationError("Invalid quantity"));
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Invalid quantity");
  });

  test("maps PaperAuthenticationError to UNAUTHORIZED", () => {
    const err = toTrpcError(new PaperAuthenticationError());
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.message).toBe("Authentication required for paper trading");
  });

  test("maps PaperOrderNotFoundError to NOT_FOUND", () => {
    const err = toTrpcError(new PaperOrderNotFoundError("Order not found"));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Order not found");
  });

  test("maps conflict errors to CONFLICT", () => {
    const quoteErr = toTrpcError(new PaperQuoteRejectedError("Quote rejected"));
    expect(quoteErr.code).toBe("CONFLICT");

    const marginErr = toTrpcError(new PaperInsufficientMarginError("Margin exceeded"));
    expect(marginErr.code).toBe("CONFLICT");

    const lockedErr = toTrpcError(new PaperAccountLockedError("Account locked"));
    expect(lockedErr.code).toBe("CONFLICT");

    const conflictErr = toTrpcError(new PaperOrderConflictError("Order conflict"));
    expect(conflictErr.code).toBe("CONFLICT");

    const idemErr = toTrpcError(new PaperIdempotencyConflictError("Idempotency conflict"));
    expect(idemErr.code).toBe("CONFLICT");

    const concErr = toTrpcError(new PaperConcurrencyError());
    expect(concErr.code).toBe("CONFLICT");
  });

  test("maps unknown errors to INTERNAL_SERVER_ERROR without exposing DB tracebacks", () => {
    const err = toTrpcError(new Error("FATAL DB ERROR: select * from users where internal_secret = 123"));
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err.message).toBe("Paper trading request failed");
  });
});
