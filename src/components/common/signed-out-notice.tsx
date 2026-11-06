import type { PaperAccountStatus } from "@/lib/paper-account-status";
import { PAPER_ACCOUNT_UNAVAILABLE_MESSAGE, SESSION_EXPIRED_MESSAGE } from "./sign-in-required";

const NOTICE_CLASS = "rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400";

/** Explains that a section needs an account, instead of showing an empty state or a raw 401. */
export function SignedOutNotice({ feature }: { feature: string }) {
  return (
    <p role="status" className={NOTICE_CLASS}>
      {feature} require a signed-in account. Sign-in is coming soon.
    </p>
  );
}

/**
 * One line for a stored session whose paper account could not be loaded: the server rejected
 * the session (401), or failed to load the account (with Retry). Renders nothing otherwise.
 */
export function PaperAccountNotice({
  status,
  onRetry,
  className = "",
}: {
  status: PaperAccountStatus;
  onRetry: () => void;
  className?: string;
}) {
  if (status === "unauthorized") {
    return <p role="status" className={`${NOTICE_CLASS} ${className}`}>{SESSION_EXPIRED_MESSAGE}</p>;
  }
  if (status !== "unavailable") return null;
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2 ${NOTICE_CLASS} ${className}`}>
      <span>{PAPER_ACCOUNT_UNAVAILABLE_MESSAGE}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-amber-500/40 px-2 py-0.5 font-semibold text-amber-300 hover:bg-amber-500/20"
      >
        Retry
      </button>
    </div>
  );
}
