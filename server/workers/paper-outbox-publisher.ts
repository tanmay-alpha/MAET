/**
 * Relays committed paper-trading outbox events to Redis pub/sub, where
 * GET /api/paper/stream forwards them to the user's browser.
 *
 * Delivery is at least once: a batch is claimed with FOR UPDATE SKIP LOCKED,
 * published, and marked PUBLISHED inside one transaction, so the row lock
 * holds until the mark commits and no other publisher can claim the same
 * rows meanwhile. If the process dies after publishing but before the
 * commit, the events stay PENDING and are published again; consumers treat
 * the event id as the deduplication key.
 *
 * While Redis is not ready the database is not touched at all: events stay
 * PENDING and go out once Redis reconnects.
 */
import type postgres from "postgres";
import { paperUserChannel, type PaperStreamMessage } from "@shared/domain/paper-trading/stream-events";
import { getSqlClient } from "../data/drizzle/client";
import { DatabaseUnavailableError, withOptionalDatabase } from "../data/drizzle/availability";
import { getRedis } from "../data/redis/client";
import { getLogger } from "../infra/logger";

export interface OutboxPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export interface OutboxPublisherDeps {
  /** The Redis publisher, or undefined while Redis cannot serve commands. */
  publisher?: () => OutboxPublisher | undefined;
  sql?: () => postgres.Sql;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 50;
const MAX_RETRY_DELAY_SECONDS = 300;
const BUSY_POLL_MS = 50;
const IDLE_POLL_MS = 1_000;
const ERROR_POLL_MS = 5_000;

type OutboxRow = {
  id: string;
  user_id: string;
  generation: number;
  event_type: PaperStreamMessage["eventType"];
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  attempt_count: number;
};

function log() {
  return getLogger().child({ worker: "paper-outbox-publisher" });
}

function readyRedisPublisher(): OutboxPublisher | undefined {
  try {
    const redis = getRedis();
    return redis.status === "ready" ? redis : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Claims, publishes and marks one batch in a single transaction. Returns the
 * number of events claimed (0 when there was nothing due or Redis is down).
 * Throws on database errors.
 */
export async function processOutboxBatch(deps: OutboxPublisherDeps = {}): Promise<number> {
  const publisher = (deps.publisher ?? readyRedisPublisher)();
  if (!publisher) return 0;
  const sql = (deps.sql ?? getSqlClient)();
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  return withOptionalDatabase(() =>
    sql.begin(async (tx) => {
      const events = await tx<OutboxRow[]>`
        SELECT id, user_id, generation, event_type, aggregate_type, aggregate_id, payload, attempt_count
        FROM public.paper_outbox_events
        WHERE status = 'PENDING'
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      const published: string[] = [];
      for (const event of events) {
        const message: PaperStreamMessage = {
          id: event.id,
          userId: event.user_id,
          generation: event.generation,
          eventType: event.event_type,
          aggregateType: event.aggregate_type,
          aggregateId: event.aggregate_id,
          payload: event.payload,
          publishedAt: new Date().toISOString(),
        };
        try {
          await publisher.publish(paperUserChannel(event.user_id), JSON.stringify(message));
          published.push(event.id);
        } catch (error) {
          // Redis failed mid-batch: back this event off and leave the rest of the
          // batch PENDING (unchanged) for the next attempt instead of failing each one.
          const attempts = event.attempt_count + 1;
          const delaySeconds = Math.min(2 ** attempts, MAX_RETRY_DELAY_SECONDS);
          await tx`
            UPDATE public.paper_outbox_events
            SET attempt_count = ${attempts},
                last_error = ${errorMessage(error)},
                next_attempt_at = NOW() + make_interval(secs => ${delaySeconds})
            WHERE id = ${event.id}
          `;
          break;
        }
      }

      if (published.length > 0) {
        await tx`
          UPDATE public.paper_outbox_events
          SET status = 'PUBLISHED', published_at = NOW(), last_error = NULL
          WHERE id = ANY(${published}::uuid[])
        `;
      }
      return events.length;
    })
  );
}

let isRunning = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

async function runOnce(): Promise<number> {
  try {
    const processed = await processOutboxBatch();
    return processed > 0 ? BUSY_POLL_MS : IDLE_POLL_MS;
  } catch (error) {
    if (!(error instanceof DatabaseUnavailableError)) {
      log().warn({ err: errorMessage(error) }, "paper outbox batch failed; events stay pending");
    }
    return ERROR_POLL_MS;
  }
}

function scheduleNext(delayMs: number): void {
  if (!isRunning) return;
  loopTimer = setTimeout(() => {
    loopTimer = null;
    inFlight = runOnce().then((nextDelayMs) => {
      inFlight = null;
      scheduleNext(nextDelayMs);
    });
  }, delayMs);
}

export function startOutboxPublisherWorker(): void {
  if (isRunning) return;
  isRunning = true;
  scheduleNext(0);
}

/** Stops polling and waits for a batch in progress to commit or roll back. */
export async function stopOutboxPublisherWorker(): Promise<void> {
  isRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  await inFlight;
}

export function isOutboxPublisherRunning(): boolean {
  return isRunning;
}
