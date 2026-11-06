import { describe, expect, test } from "bun:test";
import { AuthenticationError, TrpcRequestError } from "./trpc";
import { paperAccountBlockedReason, paperAccountStatus } from "./paper-account-status";
import {
  PAPER_ACCOUNT_UNAVAILABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SIGN_IN_REQUIRED_MESSAGE,
} from "@/components/common/sign-in-required";

const serverError = new TrpcRequestError("Database unavailable", 500, "INTERNAL_SERVER_ERROR");

describe("paperAccountStatus", () => {
  test("a visitor without a stored session is signed out, whatever the cache holds", () => {
    expect(paperAccountStatus({ signedIn: false, hasAccount: false, error: null })).toBe("signed-out");
    expect(paperAccountStatus({ signedIn: false, hasAccount: true, error: new AuthenticationError() })).toBe("signed-out");
  });

  test("a stored session waiting for its first account response is loading", () => {
    expect(paperAccountStatus({ signedIn: true, hasAccount: false, error: null })).toBe("loading");
  });

  test("an account the server returned is ready", () => {
    expect(paperAccountStatus({ signedIn: true, hasAccount: true, error: null })).toBe("ready");
  });

  test("a 401 means the stored session was rejected, even with an account cached from before", () => {
    expect(paperAccountStatus({ signedIn: true, hasAccount: false, error: new AuthenticationError() })).toBe("unauthorized");
    expect(paperAccountStatus({ signedIn: true, hasAccount: true, error: new AuthenticationError() })).toBe("unauthorized");
  });

  test("server and network failures make the account unavailable, never stale-but-shown", () => {
    expect(paperAccountStatus({ signedIn: true, hasAccount: false, error: serverError })).toBe("unavailable");
    expect(paperAccountStatus({ signedIn: true, hasAccount: true, error: serverError })).toBe("unavailable");
    expect(paperAccountStatus({ signedIn: true, hasAccount: false, error: new TypeError("Failed to fetch") })).toBe("unavailable");
  });
});

describe("paperAccountBlockedReason", () => {
  test("account actions are allowed only once the account loaded", () => {
    expect(paperAccountBlockedReason("ready")).toBeNull();
    expect(paperAccountBlockedReason("signed-out")).toBe(SIGN_IN_REQUIRED_MESSAGE);
    expect(paperAccountBlockedReason("unauthorized")).toBe(SESSION_EXPIRED_MESSAGE);
    expect(paperAccountBlockedReason("unavailable")).toBe(PAPER_ACCOUNT_UNAVAILABLE_MESSAGE);
    expect(paperAccountBlockedReason("loading")).toBe("Loading the paper account…");
  });

  test("the user-facing lines say what happened and what to do", () => {
    expect(SESSION_EXPIRED_MESSAGE).toBe("Your session has expired. Sign in again.");
    expect(PAPER_ACCOUNT_UNAVAILABLE_MESSAGE).toBe("Paper account unavailable: the server could not load it.");
  });
});
