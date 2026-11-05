import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { QuickTradeModal } from "./quick-trade-modal";

describe("QuickTradeModal", () => {
  test("a closed modal renders nothing and runs no data hooks", () => {
    // No QueryClientProvider: if the closed modal called usePaperAccount() or
    // useMarketQuotes() (which open SSE subscriptions on mount), render would throw.
    expect(renderToString(<QuickTradeModal isOpen={false} onClose={() => {}} />)).toBe("");
  });
});
