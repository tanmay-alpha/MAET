import { describe, expect, it } from "bun:test";
import { DailyProcessorSchedule, isDailyProcessorWindow } from "./daily-processor-schedule";

// 2026-11-05 is a Thursday. IST = UTC + 05:30.
const THU_1829_IST = new Date("2026-11-05T12:59:00.000Z");
const THU_1847_IST = new Date("2026-11-05T13:17:00.000Z");
const THU_2300_IST = new Date("2026-11-05T17:30:00.000Z");
const FRI_1900_IST = new Date("2026-11-06T13:30:00.000Z");
const SAT_1900_IST = new Date("2026-11-07T13:30:00.000Z");

function sharedLock() {
  const taken = new Set<string>();
  return async (istDate: string) => {
    if (taken.has(istDate)) return false;
    taken.add(istDate);
    return true;
  };
}

function schedule(acquireLock: (istDate: string) => Promise<boolean>, holidays: Date[] = []) {
  const runs: string[] = [];
  const s = new DailyProcessorSchedule({
    acquireLock,
    run: async () => {
      runs.push("run");
    },
    holidays: () => holidays,
  });
  return { s, runs };
}

describe("isDailyProcessorWindow", () => {
  it("opens at 18:30 IST on weekdays and stays open for the rest of the IST day", () => {
    expect(isDailyProcessorWindow(THU_1829_IST, [])).toBe(false);
    expect(isDailyProcessorWindow(THU_1847_IST, [])).toBe(true);
    expect(isDailyProcessorWindow(THU_2300_IST, [])).toBe(true);
  });

  it("is closed on weekends and exchange holidays", () => {
    expect(isDailyProcessorWindow(SAT_1900_IST, [])).toBe(false);
    expect(isDailyProcessorWindow(FRI_1900_IST, [new Date("2026-11-06")])).toBe(false);
  });
});

describe("DailyProcessorSchedule", () => {
  it("runs once per IST day even when the 18:30 tick was missed", async () => {
    const { s, runs } = schedule(sharedLock());
    expect(await s.tick(THU_1829_IST)).toBe(false);
    expect(await s.tick(THU_1847_IST)).toBe(true);
    expect(await s.tick(THU_2300_IST)).toBe(false);
    expect(await s.tick(FRI_1900_IST)).toBe(true);
    expect(runs).toHaveLength(2);
  });

  it("lets only one instance run per day when they share the lock", async () => {
    const lock = sharedLock();
    const a = schedule(lock);
    const b = schedule(lock);
    await Promise.all([a.s.tick(THU_1847_IST), b.s.tick(THU_1847_IST)]);
    await Promise.all([a.s.tick(THU_2300_IST), b.s.tick(THU_2300_IST)]);
    expect(a.runs.length + b.runs.length).toBe(1);
  });

  it("does not start a second run while one is in progress", async () => {
    const gate = Promise.withResolvers<void>();
    let runs = 0;
    const s = new DailyProcessorSchedule({
      acquireLock: async () => true,
      run: async () => {
        runs++;
        await gate.promise;
      },
      holidays: () => [],
    });
    const first = s.tick(THU_1847_IST);
    expect(await s.tick(THU_1847_IST)).toBe(false);
    gate.resolve();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
  });

  it("still runs once when the lock store is unavailable", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const s = new DailyProcessorSchedule({
      acquireLock: async () => {
        throw new Error("redis down");
      },
      run: async () => {
        runs++;
      },
      holidays: () => [],
      onLockError: (error) => errors.push(error),
    });
    await s.tick(THU_1847_IST);
    await s.tick(THU_2300_IST);
    expect(runs).toBe(1);
    expect(errors).toHaveLength(1);
  });
});
