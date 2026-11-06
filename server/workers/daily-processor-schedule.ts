import { computePhase, istClock, istDateKey } from "../domain/market/clock";

/** 18:30 IST: after the close and after NSE publishes end-of-day files. */
export const DAILY_PROCESSOR_IST_MINUTES = 18 * 60 + 30;

/**
 * How long one run may hold the cross-instance lock. A run that crashes
 * leaves the lock behind; it expires after this and the job retries the
 * same evening. Also the in-process retry delay after a failed run.
 */
export const DAILY_PROCESSOR_LOCK_TTL_MS = 2 * 60 * 60 * 1000;

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
  /** Cross-instance run lock for an IST date, expiring after DAILY_PROCESSOR_LOCK_TTL_MS. */
  acquireLock: (istDate: string) => Promise<boolean>;
  /** Cross-instance record that the run for an IST date succeeded. */
  isCompleted: (istDate: string) => Promise<boolean>;
  markCompleted: (istDate: string) => Promise<void>;
  run: () => Promise<void>;
  holidays: () => Date[];
  onLockError?: (error: unknown) => void;
  /**
   * The run upserts thousands of rows; while the database circuit is open it
   * would fail at once and then wait out the two-hour retry. Not starting
   * leaves the next minute's tick free to run it as soon as the circuit closes.
   */
  isDatabaseAvailable?: () => boolean;
};

/**
 * Runs the daily processor at most once per IST date. A date counts as done
 * only after a successful run: the in-process date check avoids hitting
 * Redis every minute, the completion marker stops other instances, and the
 * lock stops two instances running at the same time.
 */
export class DailyProcessorSchedule {
  private completedIstDate: string | undefined;
  private retryNotBefore = 0;
  private running = false;

  constructor(private readonly deps: DailyProcessorScheduleDeps) {}

  /** Returns true when this call ran the job; rejects if the run failed. */
  async tick(now: Date = new Date()): Promise<boolean> {
    if (this.running || !isDailyProcessorWindow(now, this.deps.holidays())) return false;
    const istDate = istDateKey(now);
    if (this.completedIstDate === istDate || now.getTime() < this.retryNotBefore) return false;
    if (this.deps.isDatabaseAvailable && !this.deps.isDatabaseAvailable()) return false;

    this.running = true;
    try {
      if (await this.guard(() => this.deps.isCompleted(istDate), false)) {
        this.completedIstDate = istDate;
        return false;
      }
      // Redis down: a missed day is worse than a duplicate run of an upsert-only job.
      if (!(await this.guard(() => this.deps.acquireLock(istDate), true))) return false;

      try {
        await this.deps.run();
      } catch (error) {
        // The lock (if any) stays until it expires; without Redis, wait as long.
        this.retryNotBefore = now.getTime() + DAILY_PROCESSOR_LOCK_TTL_MS;
        throw error;
      }
      this.completedIstDate = istDate;
      await this.guard(() => this.deps.markCompleted(istDate), undefined);
      return true;
    } finally {
      this.running = false;
    }
  }

  private async guard<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.deps.onLockError?.(error);
      return fallback;
    }
  }
}
