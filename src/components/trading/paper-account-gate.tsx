import type { ReactNode } from "react";
import { SignedOutNotice } from "@/components/common/signed-out-notice";

/** Keep account figures and actions out of the public, signed-out view. */
export function PaperAccountGate({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  return signedIn ? children : <SignedOutNotice feature="Paper account balances and positions" />;
}
