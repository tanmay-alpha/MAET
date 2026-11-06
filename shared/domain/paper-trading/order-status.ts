/**
 * Persisted order statuses (the `paper_order_status` enum) under which an order is still
 * working: it can fill further and the user can cancel it. Every other status is terminal.
 * TRIGGER_PENDING exists only in the database (an untriggered stop); the execution domain
 * calls it PENDING. A PARTIALLY_FILLED order keeps working for its unfilled remainder.
 */
export const WORKING_ORDER_STATUSES = ["PENDING", "TRIGGER_PENDING", "TRIGGERED", "PARTIALLY_FILLED"] as const;

export type WorkingOrderStatus = (typeof WORKING_ORDER_STATUSES)[number];

const WORKING_STATUS_LOOKUP: ReadonlySet<string> = new Set(WORKING_ORDER_STATUSES);

export function isWorkingOrderStatus(status: string): status is WorkingOrderStatus {
  return WORKING_STATUS_LOOKUP.has(status);
}
