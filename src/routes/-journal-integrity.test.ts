import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { trpc } from "../lib/trpc";

describe("Journal integrity", () => {
  it("does not present fabricated review metrics", () => {
    const journalPath = resolve(__dirname, "../../src/routes/_app.journal.tsx");
    const content = readFileSync(journalPath, "utf-8");

    expect(content).not.toContain("100.0%");
    expect(content).not.toContain("(trpc as any).paperTrading.getState.useQuery()");
    expect(content).toContain("usePaperAccount()");
    expect(content).toContain("Unavailable until review outcomes are recorded.");
  });

  it("exposes the thesis-list client procedure required by Journal", () => {
    const tradeTheses = Reflect.get(trpc, "tradeTheses") as { list?: { useQuery?: unknown } } | undefined;

    expect(typeof tradeTheses?.list?.useQuery).toBe("function");
  });
});
