const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
/** Triggers this far apart are unrelated; the next one starts from the minimum again. */
const QUIET_PERIOD_MS = 10 * 60_000;

/**
 * Delay before re-logging in to Angel One after the session is rejected.
 * Angel One keeps one session per client, so two instances overlapping
 * during a deploy invalidate each other's JWT on every login; doubling the
 * delay (1s → 60s) stops that ping-pong from hammering the login API.
 */
export class ReloginBackoff {
  private delayMs = 0;
  private lastTriggerMs = Number.NEGATIVE_INFINITY;

  next(nowMs: number): number {
    const repeated = nowMs - this.lastTriggerMs < QUIET_PERIOD_MS;
    this.delayMs = repeated ? Math.min(this.delayMs * 2, MAX_DELAY_MS) : MIN_DELAY_MS;
    this.lastTriggerMs = nowMs;
    return this.delayMs;
  }
}
