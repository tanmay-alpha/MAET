import { describe, expect, it } from "bun:test";
import { ReloginBackoff } from "./relogin-backoff";

describe("ReloginBackoff", () => {
  it("doubles the delay on repeated triggers from 1s up to 60s", () => {
    const backoff = new ReloginBackoff();
    const delays = Array.from({ length: 9 }, (_, index) => backoff.next(index * 1_000));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("starts again at 1s once triggers stop for the quiet period", () => {
    const backoff = new ReloginBackoff();
    backoff.next(0);
    backoff.next(1_000);
    expect(backoff.next(2_000)).toBe(4_000);
    expect(backoff.next(2_000 + 10 * 60_000)).toBe(1_000);
  });
});
