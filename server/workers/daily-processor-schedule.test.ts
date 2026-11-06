import { describe, expect, it } from "bun:test";
import {
  DailyProcessorSchedule,
  isDailyProcessorWindow,
  type DailyProcessorScheduleDeps,
} from "./daily-processor-schedule";

// 2026-11-05 is a Thursday. IST = UTC + 05:30.
const THU_1829_IST = new Date("2026-11-05T12:59:00.000Z");
const THU_1847_IST = new Date("2026-11-05T13:17:00.000Z");
const THU_1848_IST = new Date("2026-11-05T13:18:00.000Z");
const THU_2050_IST = new Date("2026-11-05T15:20:00.000Z");
const THU_2300_IST = new Date("2026-11-05T17:30:00.000Z");
const FRI_1900_IST = new Date("2026-11-06T13:30:00.000Z");
const SAT_1900_IST = new Date("2026-11-07T13:30:00.000Z");

const LOCK_TTL_MS = 2 * 60 * 60 * 1000;

/** Redis stand-in shared by "instances": an expiring lock plus a completion marker. */
function sharedStore() {
  let now = 0;
  const locks = new Map<string, number>();
  const completed = new Set<string>();
  return {
    setNow: (date: Date) => {
      now = date.getTime();
    },
    deps: {
      acquireLock: async (istDate: string) => {
        const expiresAt = locks.get(istDate);
        if (expiresAt !== undefined && expiresAt > now) return false;
        locks.set(istDate, now + LOCK_TTL_MS);
        return true;
      },
      isCompleted: async (istDate: string) => completed.has(istDate),
      markCompleted: async (istDate: string) => {
        completed.add(istDate);
      },
    } satisfies Partial<DailyProcessorScheduleDeps>,
  };
}

function instance(store: ReturnType<typeof sharedStore>, run: () => Promise<void> = async () => {}) {
  let runs = 0;
  const schedule = new DailyProcessorSchedule({
    ...store.deps,
    run: async () => {
      runs++;
      await run();
    },
    holidays: () => [],
  });
  return {
    tick: (now: Date) => {
      store.setNow(now);
      return schedule.tick(now);
    },
    runs: () => runs,
  };
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
    const a = instance(sharedStore());
    expect(await a.tick(THU_1829_IST)).toBe(false);
    expect(await a.tick(THU_1847_IST)).toBe(true);
    expect(await a.tick(THU_2300_IST)).toBe(false);
    expect(await a.tick(FRI_1900_IST)).toBe(true);
    expect(a.runs()).toBe(2);
  });

  it("lets only one instance run per day, even after the lock expires", async () => {
    const store = sharedStore();
    const a = instance(store);
    const b = instance(store);
    await Promise.all([a.tick(THU_1847_IST), b.tick(THU_1847_IST)]);
    await b.tick(THU_2300_IST);
    expect(a.runs() + b.runs()).toBe(1);
  });

  it("retries the same evening once the lock of a failed run expires", async () => {
    const store = sharedStore();
    let fail = true;
    const a = instance(store, async () => {
      if (fail) throw new Error("ingestion crashed");
    });
    await expect(a.tick(THU_1847_IST)).rejects.toThrow("ingestion crashed");
    fail = false;
    // Lock still held: no immediate retry loop.
    expect(await a.tick(THU_1848_IST)).toBe(false);
    expect(await a.tick(THU_2050_IST)).toBe(true);
    expect(a.runs()).toBe(2);
    expect(await a.tick(THU_2300_IST)).toBe(false);
  });

  it("does not start a second run while one is in progress", async () => {
    const gate = Promise.withResolvers<void>();
    const a = instance(sharedStore(), () => gate.promise);
    const first = a.tick(THU_1847_IST);
    expect(await a.tick(THU_1847_IST)).toBe(false);
    gate.resolve();
    expect(await first).toBe(true);
    expect(a.runs()).toBe(1);
  });

  it("still runs once when the lock store is unavailable", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const down = async (): Promise<never> => {
      throw new Error("redis down");
    };
    const s = new DailyProcessorSchedule({
      acquireLock: down,
      isCompleted: down,
      markCompleted: down,
      run: async () => {
        runs++;
      },
      holidays: () => [],
      onLockError: (error) => errors.push(error),
    });
    await s.tick(THU_1847_IST);
    await s.tick(THU_2300_IST);
    expect(runs).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("does not start (or take the lock) while the database circuit is open, and runs once it closes", async () => {
    const store = sharedStore();
    let available = false;
    let runs = 0;
    let lockAttempts = 0;
    const s = new DailyProcessorSchedule({
      ...store.deps,
      acquireLock: async (istDate) => {
        lockAttempts++;
        return store.deps.acquireLock(istDate);
      },
      run: async () => {
        runs++;
      },
      holidays: () => [],
      isDatabaseAvailable: () => available,
    });
    store.setNow(THU_1847_IST);
    expect(await s.tick(THU_1847_IST)).toBe(false);
    expect(await s.tick(THU_1848_IST)).toBe(false);
    expect(runs).toBe(0);
    expect(lockAttempts).toBe(0);

    // No two-hour penalty for a skipped start: the next minute's tick runs it.
    available = true;
    expect(await s.tick(THU_1848_IST)).toBe(true);
    expect(runs).toBe(1);
  });
});
