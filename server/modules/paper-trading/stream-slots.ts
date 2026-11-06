/** Each paper SSE stream holds its own Redis subscriber connection, so streams are capped per user. */
export const MAX_PAPER_STREAMS_PER_USER = 3;

/**
 * Counts open streams per user in this process (the API runs as a single instance).
 * acquire() returns an idempotent release callback, or null when the user is at the cap.
 */
export class StreamSlots {
  private readonly open = new Map<string, number>();

  constructor(private readonly limit: number) {}

  acquire(userId: string): (() => void) | null {
    const current = this.open.get(userId) ?? 0;
    if (current >= this.limit) {
      return null;
    }
    this.open.set(userId, current + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.open.get(userId) ?? 1) - 1;
      if (remaining > 0) this.open.set(userId, remaining);
      else this.open.delete(userId);
    };
  }
}

export const paperStreamSlots = new StreamSlots(MAX_PAPER_STREAMS_PER_USER);
