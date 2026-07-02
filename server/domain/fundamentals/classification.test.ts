import { describe, expect, it } from "bun:test";
import { classifyByMarketCapRank } from "./classification";

describe("classifyByMarketCapRank", () => {
  it("uses Indian rank bands and keeps missing values unknown", () => {
    const rows = Array.from({ length: 252 }, (_, index) => ({
      companyId: `C${String(index + 1).padStart(3, "0")}`,
      marketCap: 1_000_000 - index,
    }));
    rows.push({ companyId: "MISSING", marketCap: Number.NaN });
    const result = classifyByMarketCapRank(rows);
    expect(result.find((row) => row.companyId === "C100")?.bucket).toBe("large");
    expect(result.find((row) => row.companyId === "C101")?.bucket).toBe("mid");
    expect(result.find((row) => row.companyId === "C250")?.bucket).toBe("mid");
    expect(result.find((row) => row.companyId === "C251")?.bucket).toBe("small");
    expect(result.find((row) => row.companyId === "MISSING")?.bucket).toBe("unknown");
  });
});
