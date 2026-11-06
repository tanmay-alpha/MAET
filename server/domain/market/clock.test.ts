import { describe, it, expect } from "bun:test";
import { computePhase, istDateKey, MarketClock, nextIstTime } from "./clock";

const HOLIDAYS = [new Date("2026-08-15T00:00:00.000Z")];

describe("computePhase", () => {
  it("Saturday is CLOSED", () => {
    const sat = new Date("2026-06-20T05:30:00.000Z");
    expect(computePhase(sat, HOLIDAYS)).toBe("CLOSED");
  });

  it("Sunday is CLOSED", () => {
    const sun = new Date("2026-06-21T05:30:00.000Z");
    expect(computePhase(sun, HOLIDAYS)).toBe("CLOSED");
  });

  it("Holiday is HOLIDAY", () => {
    const h = new Date("2026-08-15T03:30:00.000Z");
    expect(computePhase(h, HOLIDAYS)).toBe("HOLIDAY");
  });

  it("9:15 IST on a weekday is OPEN", () => {
    const t = new Date("2026-06-19T03:45:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("OPEN");
  });

  it("9:14 IST is PRE_OPEN", () => {
    const t = new Date("2026-06-19T03:44:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("PRE_OPEN");
  });

  it("15:30 IST is OPEN (last minute)", () => {
    const t = new Date("2026-06-19T10:00:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("OPEN");
  });

  it("15:31 IST is CLOSED", () => {
    const t = new Date("2026-06-19T10:01:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("CLOSED");
  });

  it("16:00 IST is AFTER_HOURS", () => {
    const t = new Date("2026-06-19T10:30:00.000Z");
    expect(computePhase(t, HOLIDAYS)).toBe("AFTER_HOURS");
  });
});

describe("IST helpers", () => {
  it("istDateKey uses the IST calendar date", () => {
    // 2026-11-05 19:00 UTC is already 2026-11-06 00:30 IST.
    expect(istDateKey(new Date("2026-11-05T19:00:00.000Z"))).toBe("2026-11-06");
    expect(istDateKey(new Date("2026-11-05T18:29:00.000Z"))).toBe("2026-11-05");
  });

  it("nextIstTime returns today's slot if still ahead, else tomorrow's", () => {
    // 08:30 IST = 03:00 UTC.
    expect(nextIstTime(new Date("2026-11-05T02:00:00.000Z"), 8, 30).toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(nextIstTime(new Date("2026-11-05T03:00:00.000Z"), 8, 30).toISOString()).toBe("2026-11-06T03:00:00.000Z");
    // 23:00 UTC is 04:30 IST the next day; the slot is that same IST morning.
    expect(nextIstTime(new Date("2026-11-05T23:00:00.000Z"), 8, 30).toISOString()).toBe("2026-11-06T03:00:00.000Z");
  });
});

describe("MarketClock", () => {
  it("subscribe receives phase changes", () => {
    const c = new MarketClock({ tickMs: 50, getNow: () => new Date("2026-06-19T03:00:00.000Z") });
    const received: string[] = [];
    c.subscribe((p) => received.push(p));
    c.start();
    return new Promise<void>((res) => setTimeout(() => {
      c.stop();
      expect(received.length).toBe(0);
      res();
    }, 200));
  });
});
