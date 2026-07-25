import type { NewPaperOutboxEventRow } from "./contracts";

export interface EventBuilderInput {
  userId: string;
  generation: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

function buildEvent(
  eventType: string,
  input: EventBuilderInput
): NewPaperOutboxEventRow {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    generation: input.generation,
    eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
    status: "PENDING",
    attemptCount: 0,
    createdAt: new Date(),
  };
}

export function buildOrderAcceptedEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ORDER_ACCEPTED", input);
}

export function buildOrderTriggeredEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ORDER_TRIGGERED", input);
}

export function buildOrderPartiallyFilledEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ORDER_PARTIALLY_FILLED", input);
}

export function buildOrderFilledEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ORDER_FILLED", input);
}

export function buildOrderCancelledEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ORDER_CANCELLED", input);
}

export function buildOrderRejectedEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ORDER_REJECTED", input);
}

export function buildPositionUpdatedEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_POSITION_UPDATED", input);
}

export function buildAccountUpdatedEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ACCOUNT_UPDATED", input);
}

export function buildLiquidationStartedEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_LIQUIDATION_STARTED", input);
}

export function buildLiquidationCompletedEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_LIQUIDATION_COMPLETED", input);
}

export function buildAccountResetEvent(input: EventBuilderInput): NewPaperOutboxEventRow {
  return buildEvent("PAPER_ACCOUNT_RESET", input);
}
