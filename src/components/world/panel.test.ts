import { describe, expect, it } from "bun:test";
import { formatAsOf } from "./panel";

describe("formatAsOf", () => {
  const now = Date.parse("2026-11-07T08:00:00.000Z"); // 13:30 IST, 7 Nov

  it("gives the IST time alone for data from today in India, though its UTC date is yesterday", () => {
    expect(formatAsOf("2026-11-06T18:40:00.000Z", now)).toBe("00:10 IST");
  });

  it("adds the IST date for data from an earlier Indian day", () => {
    const yesterday = formatAsOf("2026-11-06T18:20:00.000Z", now);
    expect(yesterday).toContain("23:50 IST");
    expect(yesterday).toContain("06");
    expect(yesterday).not.toBe("23:50 IST");
  });
});
