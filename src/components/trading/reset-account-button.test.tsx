import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { ResetAccountButton } from "./reset-account-button";
import { SIGN_IN_REQUIRED_MESSAGE } from "@/components/common/sign-in-required";

describe("ResetAccountButton", () => {
  test("is disabled and explains why for a signed-out visitor", () => {
    let resets = 0;
    const html = renderToString(
      <ResetAccountButton onReset={() => resets++} confirmMessage="Reset?">
        Reset Account
      </ResetAccountButton>
    );

    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain(SIGN_IN_REQUIRED_MESSAGE);
    expect(resets).toBe(0);
  });
});
