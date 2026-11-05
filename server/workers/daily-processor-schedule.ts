import { computePhase, istClock, istDateKey } from "../domain/market/clock";

/** 18:30 IST: after the close and after NSE publishes end-of-day files. */
export const DAILY_PROCESSOR_IST_MINUTES = 18 * 60 + 30;

/**
 * True on an IST weekday that is not an exchange holiday, at or after 18:30
 * IST. Using ">=" instead of an exact-minute match means a late or skipped
 * timer tick still runs that day's job.
 */
export function isDailyProcessorWindow(now: Date, holidays: Date[]): boolean {
  const { minutes, weekday } = istClock(now);
  if (weekday === 0 || weekday === 6) return false;
  if (computePhase(now, holidays) === "HOLIDAY") return false;
  return minutes >= DAILY_PROCESSOR_IST_MINUTES;
}

export type DailyProcessorScheduleDeps = {
  /** Cross-instance guard: resolves true only for the first caller per IST date. */
  acquireLock: (istDate: string) => Promise<boolean>;
  run: () => Promise<void>;
  holidays: () => Date[];
  onLockError?: (error: unknown) => void;
};

/**
 * Runs the daily processor at most once per IST date. The in-process date
 * check avoids hitting Redis every minute; the Redis lock stops a second
 * instance (overlapping deploys, scale-out) from running the same day.
 */
export class DailyProcessorSchedule {
  private lastRunIstDate: string | undefined;
  private running = false;

  constructor(private readonly deps: DailyProcessorScheduleDeps) {}

  /** Returns true when this call started the run. */
  async tick(now: Date = new Date()): Promise<boolean> {
    if (this.running || !isDailyProcessorWindow(now, this.deps.holidays())) return false;
    const istDate = istDateKey(now);
    if (this.lastRunIstDate === istDate) return false;

    this.running = true;
    try {
      let acquired: boolean;
      try {
        acquired = await this.deps.acquireLock(istDate);
      } catch (error) {
        // Redis down: a missed day is worse than a duplicate run of an idempotent job.
        this.deps.onLockError?.(error);
        acquired = true;
      }
      this.lastRunIstDate = istDate;
      if (!acquired) return false;
      await this.deps.run();
      return true;
    } finally {
      this.running = false;
    }
  }
}
