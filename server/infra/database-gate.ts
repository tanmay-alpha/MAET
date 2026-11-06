import { DatabaseUnavailableError, isConnectionError, withOptionalDatabase } from "../data/drizzle/availability";

export type DatabaseGateLog = {
  warn: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
};

/**
 * Wraps a background loop's database work (per-tick matching, periodic polls)
 * in the shared circuit breaker. While the circuit is open the work is skipped
 * without touching the database; a connection error trips the breaker. The
 * outage and the recovery are each logged once, not on every tick.
 */
export class DatabaseGate {
  private down = false;

  constructor(
    private readonly name: string,
    private readonly log: DatabaseGateLog,
    private readonly guard: <T>(operation: () => Promise<T>) => Promise<T> = withOptionalDatabase,
  ) {}

  /**
   * Runs `operation` through the breaker. Resolves to `undefined` when it was
   * skipped (circuit open) or failed with a connection error; other errors
   * propagate to the caller's own handling.
   */
  async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await this.guard(operation);
      if (this.down) {
        this.down = false;
        this.log.info({ worker: this.name }, "database reachable again; resuming");
      }
      return result;
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) {
        this.markDown();
        return undefined;
      }
      if (isConnectionError(error)) {
        this.markDown(error);
        return undefined;
      }
      throw error;
    }
  }

  private markDown(error?: unknown): void {
    if (this.down) return;
    this.down = true;
    const fields: Record<string, unknown> = { worker: this.name };
    if (error !== undefined) fields.err = error instanceof Error ? error.message : String(error);
    this.log.warn(fields, "database unavailable; skipping until it is reachable");
  }
}
