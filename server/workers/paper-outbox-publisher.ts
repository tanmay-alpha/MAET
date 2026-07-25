import { getSqlClient } from "../data/drizzle/client";
import { getRedis } from "../data/redis/client";

let isRunning = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;

export async function processOutboxBatch(): Promise<number> {
  const sql = getSqlClient();
  const redis = getRedis();

  try {
    const events = await sql<Array<{
      id: string;
      user_id: string;
      generation: number;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: unknown;
      attempt_count: number;
    }>>`
      SELECT id, user_id, generation, event_type, aggregate_type, aggregate_id, payload, attempt_count
      FROM public.paper_outbox_events
      WHERE status = 'PENDING'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY created_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `;

    if (events.length === 0) {
      return 0;
    }

    for (const event of events) {
      const channel = `paper:user:${event.user_id}`;
      const message = JSON.stringify({
        id: event.id,
        userId: event.user_id,
        generation: event.generation,
        eventType: event.event_type,
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        payload: event.payload,
        publishedAt: new Date().toISOString(),
      });

      try {
        await redis.publish(channel, message);

        await sql`
          UPDATE public.paper_outbox_events
          SET status = 'PUBLISHED',
              published_at = NOW(),
              last_error = NULL
          WHERE id = ${event.id}
        `;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const nextAttemptCount = event.attempt_count + 1;
        const delaySeconds = Math.min(Math.pow(2, nextAttemptCount), 300);

        await sql`
          UPDATE public.paper_outbox_events
          SET attempt_count = ${nextAttemptCount},
              last_error = ${errorMsg},
              next_attempt_at = NOW() + (${delaySeconds} || ' seconds')::interval
          WHERE id = ${event.id}
        `;
      }
    }

    return events.length;
  } catch (_err) {
    return 0;
  }
}

export function startOutboxPublisherWorker(): void {
  if (isRunning) return;
  isRunning = true;

  const runLoop = async () => {
    if (!isRunning) return;
    const processed = await processOutboxBatch();
    const delay = processed > 0 ? 50 : 1000;
    if (isRunning) {
      loopTimer = setTimeout(runLoop, delay);
    }
  };

  void runLoop();
}

export function stopOutboxPublisherWorker(): void {
  isRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}
