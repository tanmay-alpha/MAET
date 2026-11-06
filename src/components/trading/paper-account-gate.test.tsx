import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { PaperAccountGate } from "./paper-account-gate";

describe("PaperAccountGate", () => {
  test("does not render account figures or actions for signed-out visitors", () => {
    const html = renderToString(
      <PaperAccountGate signedIn={false}>
        <span>Portfolio equity ₹10,00,000</span>
        <button>Reset Account</button>
      </PaperAccountGate>,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Paper account balances and positions");
    expect(html).toContain("require a signed-in account.");
    expect(html).not.toContain("10,00,000");
    expect(html).not.toContain("Reset Account");
  });

  test("preserves account content for signed-in visitors", () => {
    const html = renderToString(
      <PaperAccountGate signedIn>
        <span>Portfolio equity ₹10,00,000</span>
        <button>Reset Account</button>
      </PaperAccountGate>,
    );

    expect(html).toContain("Portfolio equity ₹10,00,000");
    expect(html).toContain("Reset Account");
    expect(html).not.toContain("Sign-in is coming soon.");
  });
});
