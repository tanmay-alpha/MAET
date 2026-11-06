import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { ResetAccountButton } from "./reset-account-button";
import { SESSION_EXPIRED_MESSAGE, SIGN_IN_REQUIRED_MESSAGE } from "@/components/common/sign-in-required";
import type { PaperAccountStatus } from "@/lib/paper-account-status";

function render(accountStatus: PaperAccountStatus, onReset = () => {}) {
  return renderToString(
    <ResetAccountButton accountStatus={accountStatus} onReset={onReset} confirmMessage="Reset?">
      Reset Account
    </ResetAccountButton>
  );
}

describe("ResetAccountButton", () => {
  test("is disabled and explains why for a signed-out visitor", () => {
    let resets = 0;
    const html = render("signed-out", () => resets++);

    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain(SIGN_IN_REQUIRED_MESSAGE);
    expect(resets).toBe(0);
  });

  test("is disabled when the server rejected the stored session", () => {
    const html = render("unauthorized");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain(SESSION_EXPIRED_MESSAGE);
  });

  test("is enabled once the account has loaded", () => {
    expect(render("ready")).not.toMatch(/<button[^>]*disabled=""/);
  });
});
