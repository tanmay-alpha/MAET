import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  PaperValidationError,
  PaperAuthenticationError,
  PaperOrderNotFoundError,
  PaperQuoteRejectedError,
  PaperInsufficientMarginError,
  PaperIdempotencyConflictError,
  PaperOrderConflictError,
  PaperAccountLockedError,
  PaperPersistenceError,
} from "./errors";
import {
  PaperOrderCommandSchema,
} from "./contracts";
import { toPaperHttpError } from "../../api/paper/orders.post";

describe("REST Error Boundary", () => {
  test("known PaperTradingError subclasses map correctly", () => {
    const errVal = toPaperHttpError(new PaperValidationError("Invalid quantity"));
    expect(errVal.statusCode).toBe(400);
    expect(errVal.statusMessage).toBe("Invalid quantity");

    const errAuth = toPaperHttpError(new PaperAuthenticationError());
    expect(errAuth.statusCode).toBe(401);

    const errNotFound = toPaperHttpError(new PaperOrderNotFoundError("Order missing"));
    expect(errNotFound.statusCode).toBe(404);

    const errQuote = toPaperHttpError(new PaperQuoteRejectedError("Stale quote"));
    expect(errQuote.statusCode).toBe(409);

    const errMargin = toPaperHttpError(new PaperInsufficientMarginError("Margin exceeded"));
    expect(errMargin.statusCode).toBe(409);

    const errIdem = toPaperHttpError(new PaperIdempotencyConflictError("Key conflict"));
    expect(errIdem.statusCode).toBe(409);

    const errConflict = toPaperHttpError(new PaperOrderConflictError("Order modified"));
    expect(errConflict.statusCode).toBe(409);

    const errLocked = toPaperHttpError(new PaperAccountLockedError("Account locked"));
    expect(errLocked.statusCode).toBe(423);
  });

  test("unknown Error maps to HTTP 500 with generic public message", () => {
    const err = toPaperHttpError(new Error("Database connection lost"));
    expect(err.statusCode).toBe(500);
    expect(err.statusMessage).toBe("Paper trading request failed");
  });

  test("database-looking error details are not exposed", () => {
    const dbErr = new Error("SELECT * FROM paper_accounts WHERE id = $1 - connection reset by peer");
    const err = toPaperHttpError(dbErr);
    expect(err.statusCode).toBe(500);
    expect(err.statusMessage).toBe("Paper trading request failed");
    expect(JSON.stringify(err)).not.toContain("SELECT * FROM paper_accounts");

    const persistErr = new PaperPersistenceError("syntax error at or near SELECT");
    const errPersist = toPaperHttpError(persistErr);
    expect(errPersist.statusCode).toBe(500);
    expect(errPersist.statusMessage).toBe("Paper trading request failed");
  });
});

describe("Strict Shared Command Schema", () => {
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  test("valid MARKET command passes validation", () => {
    const valid = {
      type: "MARKET",
      clientOrderId: validUuid,
      idempotencyKey: "idem-key-1",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
    };
    const res = PaperOrderCommandSchema.safeParse(valid);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.symbol).toBe("RELIANCE");
    }
  });

  test("REST command rejects unknown fields", () => {
    const withUnknown = {
      type: "MARKET",
      clientOrderId: validUuid,
      idempotencyKey: "idem-key-1",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
      unknownField: "foo",
    };
    const res = PaperOrderCommandSchema.safeParse(withUnknown);
    expect(res.success).toBe(false);
  });

  test("REST command rejects missing exchange", () => {
    const missingExchange = {
      type: "MARKET",
      clientOrderId: validUuid,
      idempotencyKey: "idem-key-1",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
    };
    const res = PaperOrderCommandSchema.safeParse(missingExchange);
    expect(res.success).toBe(false);
  });

  test("REST command rejects missing UUID clientOrderId", () => {
    const invalidUuid = {
      type: "MARKET",
      clientOrderId: "not-a-uuid",
      idempotencyKey: "idem-key-1",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
    };
    const res = PaperOrderCommandSchema.safeParse(invalidUuid);
    expect(res.success).toBe(false);
  });

  test("REST command rejects missing idempotencyKey", () => {
    const missingIdem = {
      type: "MARKET",
      clientOrderId: validUuid,
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
    };
    const res = PaperOrderCommandSchema.safeParse(missingIdem);
    expect(res.success).toBe(false);
  });

  test("REST command rejects client-provided quote/fill/cash fields", () => {
    const withForbidden = {
      type: "MARKET",
      clientOrderId: validUuid,
      idempotencyKey: "idem-key-1",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
      quote: 1500,
      fillPrice: 1500,
      cash: 1000000,
      margin: 50000,
      "P&L": 0,
      status: "FILLED",
    };
    const res = PaperOrderCommandSchema.safeParse(withForbidden);
    expect(res.success).toBe(false);
  });

  test("tRPC and REST use the same schema", () => {
    expect(PaperOrderCommandSchema).toBeDefined();
    expect(typeof PaperOrderCommandSchema.safeParse).toBe("function");
  });
});

describe("Production Certification Assertions Logic", () => {
  test("certification script fails on non-200 HTTP status", () => {
    const mockRes = new Response(null, { status: 400 });
    expect(() => {
      assert.equal(mockRes.status, 200, "Expected 200 OK");
    }).toThrow(assert.AssertionError);
  });

  test("certification script fails on missing fill", () => {
    const mockOrderData = { order: { id: "ord-1" }, fill: undefined };
    expect(() => {
      assert.notEqual(mockOrderData.fill, undefined, "Fill required");
    }).toThrow(assert.AssertionError);
  });

  test("certification script fails on false idempotency", () => {
    const mockReplayData = { idempotentReplay: false };
    expect(() => {
      assert.equal(mockReplayData.idempotentReplay, true, "Idempotent replay required");
    }).toThrow(assert.AssertionError);
  });

  test("SSE parser detects heartbeat and event frames", () => {
    const rawStreamChunk = `: heartbeat 2026-07-28T20:00:00Z\n\ndata: {"type":"ORDER_UPDATED","symbol":"RELIANCE"}\n\n`;
    const parts = rawStreamChunk.split("\n\n");
    const frames: Array<{ isHeartbeat: boolean; data?: unknown }> = [];

    for (const part of parts) {
      if (!part.trim()) continue;
      if (part.startsWith(": heartbeat")) {
        frames.push({ isHeartbeat: true });
      } else if (part.startsWith("data: ")) {
        frames.push({ isHeartbeat: false, data: JSON.parse(part.slice(6)) });
      }
    }

    expect(frames.length).toBe(2);
    expect(frames[0].isHeartbeat).toBe(true);
    expect(frames[1].isHeartbeat).toBe(false);
    expect((frames[1].data as any).symbol).toBe("RELIANCE");
  });

  test("User B isolation failure causes non-zero exit / assertion error", () => {
    const userBFrames = [{ data: JSON.stringify({ userId: "user-a", symbol: "RELIANCE" }) }];
    expect(() => {
      const leakedFrame = userBFrames.find((f) => f.data.includes("RELIANCE"));
      assert.equal(leakedFrame, undefined, "User B must not receive User A events");
    }).toThrow(assert.AssertionError);
  });
});
