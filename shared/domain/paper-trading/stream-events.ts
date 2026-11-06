/**
 * Wire contract of GET /api/paper/stream, shared by the server (writer) and the
 * browser client (parser).
 *
 * Every frame is a named SSE event: `event: <name>\ndata: <json>\n\n`.
 * - CONNECTED: the server subscribed this user's notification channel.
 * - heartbeat: keep-alive while nothing else is sent.
 * - one of PAPER_OUTBOX_EVENT_TYPES: a committed paper-trading change, relayed
 *   from the transactional outbox; `data` is the PaperStreamMessage.
 */

/** Event types written to paper_outbox_events and relayed to the user's stream. */
export const PAPER_OUTBOX_EVENT_TYPES = [
  "PAPER_ORDER_ACCEPTED",
  "PAPER_ORDER_TRIGGERED",
  "PAPER_ORDER_PARTIALLY_FILLED",
  "PAPER_ORDER_FILLED",
  "PAPER_ORDER_CANCELLED",
  "PAPER_ORDER_REJECTED",
  "PAPER_POSITION_UPDATED",
  "PAPER_ACCOUNT_UPDATED",
  "PAPER_LIQUIDATION_STARTED",
  "PAPER_LIQUIDATION_COMPLETED",
  "PAPER_ACCOUNT_RESET",
] as const;

export type PaperOutboxEventType = (typeof PAPER_OUTBOX_EVENT_TYPES)[number];

export const PAPER_STREAM_CONNECTED_EVENT = "CONNECTED";
export const PAPER_STREAM_HEARTBEAT_EVENT = "heartbeat";

const OUTBOX_EVENT_TYPE_LOOKUP: ReadonlySet<string> = new Set(PAPER_OUTBOX_EVENT_TYPES);

export function isPaperOutboxEventType(value: unknown): value is PaperOutboxEventType {
  return typeof value === "string" && OUTBOX_EVENT_TYPE_LOOKUP.has(value);
}

/** The Redis pub/sub message the outbox publisher sends for one event. */
export interface PaperStreamMessage {
  id: string;
  userId: string;
  generation: number;
  eventType: PaperOutboxEventType;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  publishedAt: string;
}

/** Redis channel carrying one user's paper notifications. */
export function paperUserChannel(userId: string): string {
  return `paper:user:${userId}`;
}

/** Parses a published message; null for anything that is not a known outbox event. */
export function parsePaperStreamMessage(message: string): PaperStreamMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("eventType" in parsed) || !isPaperOutboxEventType(parsed.eventType)) return null;
  if (!("id" in parsed) || typeof parsed.id !== "string") return null;
  if (!("userId" in parsed) || typeof parsed.userId !== "string") return null;
  return parsed as PaperStreamMessage;
}

/** One named SSE frame. */
export function paperStreamFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
