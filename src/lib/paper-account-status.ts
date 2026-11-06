import { AuthenticationError } from "@/lib/trpc";
import {
  PAPER_ACCOUNT_UNAVAILABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SIGN_IN_REQUIRED_MESSAGE,
} from "@/components/common/sign-in-required";

/**
 * What the app may say about the paper account. Only "ready" carries server figures;
 * every other state shows no balances at all rather than a placeholder.
 */
export type PaperAccountStatus = "signed-out" | "loading" | "ready" | "unauthorized" | "unavailable";

export function paperAccountStatus({
  signedIn,
  hasAccount,
  error,
}: {
  signedIn: boolean;
  hasAccount: boolean;
  error: unknown;
}): PaperAccountStatus {
  if (!signedIn) return "signed-out";
  // An error wins over cached data: figures the server can no longer confirm are not shown.
  if (error instanceof AuthenticationError) return "unauthorized";
  if (error) return "unavailable";
  return hasAccount ? "ready" : "loading";
}

/** Why account actions (trade, reset) are disabled, or null when they are allowed. */
export function paperAccountBlockedReason(status: PaperAccountStatus): string | null {
  switch (status) {
    case "ready":
      return null;
    case "signed-out":
      return SIGN_IN_REQUIRED_MESSAGE;
    case "unauthorized":
      return SESSION_EXPIRED_MESSAGE;
    case "unavailable":
      return PAPER_ACCOUNT_UNAVAILABLE_MESSAGE;
    case "loading":
      return "Loading the paper account…";
  }
}
