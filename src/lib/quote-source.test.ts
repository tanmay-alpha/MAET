import { describe, expect, it } from "bun:test";
import { quoteSourceLabel, sourceName } from "./quote-source";

describe("source labels", () => {
  it("names provider ids instead of printing them raw", () => {
    expect(sourceName("angelone")).toBe("Angel One");
    expect(sourceName("yahoo_timeseries")).toBe("Yahoo Finance · time series");
    expect(sourceName("yahoo_quote_summary")).toBe("Yahoo Finance · quote summary");
    expect(sourceName("Yahoo Finance")).toBe("Yahoo Finance");
  });

  it("labels a quote with its source, delay and a closed market", () => {
    expect(quoteSourceLabel("angelone", false, "OPEN")).toBe("Angel One · live");
    expect(quoteSourceLabel("yahoo", true, "CLOSED")).toBe("Yahoo · delayed · market closed");
  });
});
