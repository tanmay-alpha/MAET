import { describe, expect, it } from "bun:test";
import { DatabaseCircuitBreaker, isConnectionError } from "./availability";

function connectionRefused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
}

function breakerAt(start = 0) {
  let now = start;
  const breaker = new DatabaseCircuitBreaker({ cooldownMs: 30_000, now: () => now });
  return { breaker, advance: (ms: number) => (now += ms) };
}

describe("isConnectionError", () => {
  it("recognises connection-class failures", () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "CONNECT_TIMEOUT", "57P01", "08006", "08001"]) {
      expect(isConnectionError(Object.assign(new Error(code), { code }))).toBe(true);
    }
    expect(isConnectionError(new Error("write CONNECT_TIMEOUT db.example.supabase.co:6543"))).toBe(true);
    expect(isConnectionError(new Error("wrapped", { cause: connectionRefused() }))).toBe(true);
  });

  it("ignores query-level errors", () => {
    expect(isConnectionError(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(false);
    expect(isConnectionError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
  });
});

describe("DatabaseCircuitBreaker", () => {
  it("goes closed → open on a connection error → half-open after the cooldown → closed on success", () => {
    const { breaker, advance } = breakerAt();
    expect(breaker.state()).toBe("closed");
    expect(breaker.isAvailable()).toBe(true);

    breaker.recordFailure(connectionRefused());
    expect(breaker.state()).toBe("open");
    expect(breaker.isAvailable()).toBe(false);

    advance(29_999);
    expect(breaker.isAvailable()).toBe(false);
    advance(1);
    expect(breaker.state()).toBe("half-open");
    // Exactly one trial request is let through.
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.isAvailable()).toBe(false);

    breaker.recordSuccess();
    expect(breaker.state()).toBe("closed");
    expect(breaker.isAvailable()).toBe(true);
  });

  it("re-opens for a fresh cooldown when the half-open trial fails", () => {
    const { breaker, advance } = breakerAt();
    breaker.recordFailure(connectionRefused());
    advance(30_000);
    expect(breaker.isAvailable()).toBe(true);

    breaker.recordFailure(connectionRefused());
    expect(breaker.state()).toBe("open");
    advance(29_000);
    expect(breaker.isAvailable()).toBe(false);
  });

  it("stays closed on query errors and treats one during the trial as reachable", () => {
    const { breaker, advance } = breakerAt();
    breaker.recordFailure(Object.assign(new Error("syntax error"), { code: "42601" }));
    expect(breaker.state()).toBe("closed");

    breaker.recordFailure(connectionRefused());
    advance(30_000);
    expect(breaker.isAvailable()).toBe(true);
    breaker.recordFailure(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(breaker.state()).toBe("closed");
  });

  it("lets a new trial through if the previous one never reported back", () => {
    const { breaker, advance } = breakerAt();
    breaker.recordFailure(connectionRefused());
    advance(30_000);
    expect(breaker.isAvailable()).toBe(true);
    advance(30_000);
    expect(breaker.isAvailable()).toBe(true);
  });

  it("follows health probe results directly", () => {
    const { breaker } = breakerAt();
    breaker.recordProbe(false);
    expect(breaker.state()).toBe("open");
    breaker.recordProbe(true);
    expect(breaker.state()).toBe("closed");
  });
});
