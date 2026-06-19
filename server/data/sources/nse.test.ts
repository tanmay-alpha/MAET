import { describe, it, expect, afterEach } from "bun:test";
import { getFundamentals, getCorporateActions, UpstreamDegradedError } from "./nse";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

const captchaHtml = "<!doctype html><html><body>Please complete the captcha to continue.</body></html>";

describe("nse source", () => {
  it("parses fundamentals from HTML", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<html><body><div id="pe">25.4</div><div id="pb">4.2</div><div id="roe">15.1</div><div id="mcap">1500000</div><div id="div_yield">1.2</div><div id="sector">IT</div></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      )) as unknown as typeof fetch;
    const f = await getFundamentals("TCS");
    expect(f.pe).toBe(25.4);
    expect(f.sector).toBe("IT");
  });

  it("treats captcha HTML as transient and retries then degrades", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response(captchaHtml, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(getFundamentals("TCS")).rejects.toBeInstanceOf(UpstreamDegradedError);
    expect(n).toBe(3);
  });

  it("parses corporate actions from a JSON endpoint", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ symbol: "TCS", exDate: "2025-06-01", action: "DIVIDEND", amount: 30 }]), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const acts = await getCorporateActions("TCS");
    expect(acts).toHaveLength(1);
    expect(acts[0].action).toBe("DIVIDEND");
  });
});
