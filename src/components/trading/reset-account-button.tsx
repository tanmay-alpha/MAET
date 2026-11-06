import { useId, type ReactNode } from "react";
import { useSignedIn } from "@/hooks/use-signed-in";
import { SIGN_IN_REQUIRED_MESSAGE } from "@/components/common/sign-in-required";

/**
 * Resets the paper account after a confirmation. Signed-out visitors have no account to
 * reset (the server answers 401), so the button is disabled and says why.
 */
export function ResetAccountButton({
  onReset,
  confirmMessage,
  className = "",
  children,
}: {
  onReset: () => unknown;
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  const signedIn = useSignedIn();
  const reasonId = useId();

  return (
    <>
      <button
        type="button"
        disabled={!signedIn}
        title={signedIn ? "Reset the paper account to its initial cash" : SIGN_IN_REQUIRED_MESSAGE}
        aria-describedby={signedIn ? undefined : reasonId}
        onClick={() => {
          if (window.confirm(confirmMessage)) void onReset();
        }}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {children}
      </button>
      {!signedIn && (
        <span id={reasonId} className="sr-only">
          {SIGN_IN_REQUIRED_MESSAGE}
        </span>
      )}
    </>
  );
}
