const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Open", className: "text-amber-300" },
  TRIGGER_PENDING: { label: "Awaiting trigger", className: "text-amber-300" },
  TRIGGERED: { label: "Triggered", className: "text-primary" },
  PARTIALLY_FILLED: { label: "Part filled", className: "text-primary" },
  FILLED: { label: "Filled", className: "text-bull" },
  REJECTED: { label: "Rejected", className: "text-bear" },
  CANCELLED: { label: "Cancelled", className: "text-muted-foreground" },
};

/** A paper order's persisted status in words; a reject reason follows it when present. */
export function PaperOrderStatus({ status, rejectReason }: { status: string; rejectReason?: string | null }) {
  const config = STATUS[status] ?? { label: status, className: "text-muted-foreground" };
  return (
    <span className={`font-sans text-[11px] font-medium ${config.className}`} title={rejectReason ?? undefined}>
      {config.label}
      {rejectReason && <span className="ml-1 font-normal text-muted-foreground">({rejectReason})</span>}
    </span>
  );
}
