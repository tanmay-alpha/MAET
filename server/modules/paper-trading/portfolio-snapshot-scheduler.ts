import type { EndOfDayRunResult, SnapshotSession } from "./portfolio-snapshots";

export interface EndOfDaySnapshotRunner {
  sessionFor(now: Date): SnapshotSession;
  runEndOfDay(now: Date): Promise<EndOfDayRunResult>;
}

export interface PortfolioSnapshotSchedulerOptions {
  intervalMs?: number;
  onRun?: (result: EndOfDayRunResult) => void;
  onError?: (error: unknown) => void;
  /** Ticks are skipped while this returns false (the database circuit is open). */
  isDatabaseAvailable?: () => boolean;
}

/**
 * Runs the end-of-day paper snapshot job in-process (Render runs a single web
 * instance and no background workers). Every tick after a session's close
 * runs the job until it completes without failures; the Postgres advisory
 * lock inside the job keeps overlapping instances from duplicating it. After
 * a restart the first tick catches up the latest closed session.
 */
export class PortfolioSnapshotScheduler {
  private completedSessionDate: string | undefined;
  private inFlight: Promise<EndOfDayRunResult | null> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly runner: EndOfDaySnapshotRunner,
    private readonly options: PortfolioSnapshotSchedulerOptions = {}
  ) {}

  /** Runs the job when the latest session has closed and is not yet done; returns its result or null. */
  async tick(now: Date = new Date()): Promise<EndOfDayRunResult | null> {
    if (this.inFlight) return null;
    if (this.options.isDatabaseAvailable && !this.options.isDatabaseAvailable()) return null;
    const session = this.runner.sessionFor(now);
    if (!session.isFinal || this.completedSessionDate === session.date) return null;

    this.inFlight = this.runner.runEndOfDay(now);
    try {
      const result = await this.inFlight;
      if (result && result.status === "ran" && result.failed === 0) {
        this.completedSessionDate = result.date;
      }
      if (result) this.options.onRun?.(result);
      return result;
    } finally {
      this.inFlight = undefined;
    }
  }

  start(): void {
    if (this.timer) return;
    const run = () => {
      this.tick().catch((error) => this.options.onError?.(error));
    };
    this.timer = setInterval(run, this.options.intervalMs ?? 60_000);
    this.timer.unref?.();
    run();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight?.catch(() => undefined);
  }
}
