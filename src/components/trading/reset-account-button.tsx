import { useId, type ReactNode } from "react";
import { paperAccountBlockedReason, type PaperAccountStatus } from "@/lib/paper-account-status";

/**
 * Resets the paper account after a confirmation. Until the account has loaded (signed out,
 * loading, session rejected, server down) there is nothing to reset, so the button is
 * disabled and says why.
 */
export function ResetAccountButton({
  accountStatus,
  onReset,
  confirmMessage,
  className = "",
  children,
}: {
  accountStatus: PaperAccountStatus;
  onReset: () => unknown;
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  const blockedReason = paperAccountBlockedReason(accountStatus);
  const reasonId = useId();

  return (
    <>
      <button
        type="button"
        disabled={blockedReason !== null}
        title={blockedReason ?? "Reset the paper account to its initial cash"}
        aria-describedby={blockedReason ? reasonId : undefined}
        onClick={() => {
          if (window.confirm(confirmMessage)) void onReset();
        }}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {children}
      </button>
      {blockedReason && (
        <span id={reasonId} className="sr-only">
          {blockedReason}
        </span>
      )}
    </>
  );
}
