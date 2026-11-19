import { afterEach, describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { quoteSourceLabel } from "@/lib/quote-source";
import { DemoModeBanner } from "./demo-mode-banner";
import { DEMO_BANNER_TEXT, SYNTHETIC_QUOTE_LABEL, setDemoModeActive } from "./demo-mode";

afterEach(() => setDemoModeActive(false));

describe("demo mode banner", () => {
  test("states that the data is synthetic and offers no way to dismiss it", () => {
    const html = renderToString(<DemoModeBanner />);
    expect(html).toContain(DEMO_BANNER_TEXT);
    expect(DEMO_BANNER_TEXT).toBe("Demo — synthetic data, not market data");
    expect(html).not.toContain("<button");
  });
});

describe("quote labels", () => {
  test("label every quote synthetic in demo mode, whatever source it reports", () => {
    setDemoModeActive(true);
    expect(quoteSourceLabel("angelone", false, "OPEN")).toBe(SYNTHETIC_QUOTE_LABEL);
    expect(quoteSourceLabel("yahoo", true, "CLOSED")).toBe(SYNTHETIC_QUOTE_LABEL);
  });

  test("never call a simulated quote live outside demo mode", () => {
    expect(quoteSourceLabel("simulated", false, "OPEN")).toBe("Simulated · synthetic");
    expect(quoteSourceLabel("angelone", false, "OPEN")).toBe("Angel One · live");
  });
});
