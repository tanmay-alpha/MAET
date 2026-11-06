import { describe, expect, it } from "bun:test";
import { DatabaseCircuitBreaker, isConnectionError } from "./availability";

function connectionRefused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
}

function probeTimeout(): Error {
  return new Error("database probe timed out after 2000ms");
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

  it("ignores query-level errors and probe timeouts", () => {
    expect(isConnectionError(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(false);
    expect(isConnectionError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isConnectionError(probeTimeout())).toBe(false);
  });
});

describe("DatabaseCircuitBreaker", () => {
  it("goes closed → open on a connection error → half-open after the cooldown → closed on trial success", () => {
    const { breaker, advance } = breakerAt();
    expect(breaker.state()).toBe("closed");
    const first = breaker.tryAcquire();
    expect(first).toBeDefined();

    breaker.recordFailure(connectionRefused(), first);
    expect(breaker.state()).toBe("open");
    expect(breaker.tryAcquire()).toBeUndefined();

    advance(29_999);
    expect(breaker.tryAcquire()).toBeUndefined();
    advance(1);
    expect(breaker.state()).toBe("half-open");
    // Exactly one trial request is let through.
    const trial = breaker.tryAcquire();
    expect(trial).toBeDefined();
    expect(breaker.tryAcquire()).toBeUndefined();

    breaker.recordSuccess(trial!);
    expect(breaker.state()).toBe("closed");
    expect(breaker.tryAcquire()).toBeDefined();
  });

  it("re-opens for a fresh cooldown when the half-open trial fails", () => {
    const { breaker, advance } = breakerAt();
    breaker.recordFailure(connectionRefused());
    advance(30_000);
    const trial = breaker.tryAcquire();
    expect(trial).toBeDefined();

    breaker.recordFailure(connectionRefused(), trial);
    expect(breaker.state()).toBe("open");
    advance(29_000);
    expect(breaker.tryAcquire()).toBeUndefined();
  });

  it("does not let a query that started before the breaker opened close it", () => {
    const { breaker, advance } = breakerAt();
    const slowQuery = breaker.tryAcquire()!;
    breaker.recordFailure(connectionRefused());

    breaker.recordSuccess(slowQuery);
    expect(breaker.state()).toBe("open");

    advance(30_000);
    const trial = breaker.tryAcquire()!;
    // A stale success arriving during the trial does not count either.
    breaker.recordSuccess(slowQuery);
    expect(breaker.state()).toBe("half-open");
    breaker.recordSuccess(trial);
    expect(breaker.state()).toBe("closed");
  });

  it("stays closed on query errors and treats one during the trial as reachable", () => {
    const { breaker, advance } = breakerAt();
    breaker.recordFailure(Object.assign(new Error("syntax error"), { code: "42601" }), breaker.tryAcquire());
    expect(breaker.state()).toBe("closed");

    breaker.recordFailure(connectionRefused());
    advance(30_000);
    const trial = breaker.tryAcquire();
    breaker.recordFailure(Object.assign(new Error("relation does not exist"), { code: "42P01" }), trial);
    expect(breaker.state()).toBe("closed");
  });

  it("lets a new trial through if the previous one never reported back", () => {
    const { breaker, advance } = breakerAt();
    breaker.recordFailure(connectionRefused());
    advance(30_000);
    expect(breaker.tryAcquire()).toBeDefined();
    advance(30_000);
    expect(breaker.tryAcquire()).toBeDefined();
  });
});

describe("DatabaseCircuitBreaker health probe", () => {
  it("opens immediately when the probe fails with a connection error", () => {
    const { breaker } = breakerAt();
    breaker.recordProbe(breaker.startProbe(), false, connectionRefused());
    expect(breaker.state()).toBe("open");
  });

  it("does not open on a probe timeout alone (busy pool) until three consecutive failures", () => {
    const { breaker } = breakerAt();
    breaker.recordProbe(breaker.startProbe(), false, probeTimeout());
    breaker.recordProbe(breaker.startProbe(), false, probeTimeout());
    expect(breaker.state()).toBe("closed");
    expect(breaker.tryAcquire()).toBeDefined();

    breaker.recordProbe(breaker.startProbe(), true);
    breaker.recordProbe(breaker.startProbe(), false, probeTimeout());
    breaker.recordProbe(breaker.startProbe(), false, probeTimeout());
    expect(breaker.state()).toBe("closed");
    breaker.recordProbe(breaker.startProbe(), false, probeTimeout());
    expect(breaker.state()).toBe("open");
  });

  it("closes on a successful probe that started after the breaker opened, but not on an older one", () => {
    const { breaker } = breakerAt();
    const olderProbe = breaker.startProbe();
    breaker.recordFailure(connectionRefused());

    breaker.recordProbe(olderProbe, true);
    expect(breaker.state()).toBe("open");

    breaker.recordProbe(breaker.startProbe(), true);
    expect(breaker.state()).toBe("closed");
  });
});
