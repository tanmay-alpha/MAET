import { describe, it, expect } from "bun:test";
import {
  getPointInTimeFundamentals,
  getActiveUniverseConstituents,
  auditUniverseSurvivorshipBias,
  type PointInTimeFundamental,
  type UniverseConstituent,
} from "./point-in-time";

describe("P2 Point-in-Time Fundamentals & Universe Membership (Commit 4)", () => {
  const mockFundamentals: PointInTimeFundamental[] = [
    // FY2022 Annual statement — filed 2022-05-10, available 2022-05-10
    {
      id: "tcs-2022-a1",
      companyId: "comp-tcs",
      symbol: "TCS",
      periodEnd: "2022-03-31T00:00:00.000Z",
      periodType: "annual",
      filingDate: "2022-05-10T00:00:00.000Z",
      availableFrom: "2022-05-10T00:00:00.000Z",
      revision: 1,
      metrics: { eps: 100, peRatio: 30, roe: 35 },
    },
    // FY2023 Annual statement — filed 2023-05-12, available 2023-05-12
    {
      id: "tcs-2023-a1",
      companyId: "comp-tcs",
      symbol: "TCS",
      periodEnd: "2023-03-31T00:00:00.000Z",
      periodType: "annual",
      filingDate: "2023-05-12T00:00:00.000Z",
      availableFrom: "2023-05-12T00:00:00.000Z",
      revision: 1,
      metrics: { eps: 115, peRatio: 28, roe: 38 },
    },
    // FY2025 EPS Revision 1 — available 2025-05-01
    {
      id: "tcs-2025-a1",
      companyId: "comp-tcs",
      symbol: "TCS",
      periodEnd: "2025-03-31T00:00:00.000Z",
      periodType: "annual",
      filingDate: "2025-05-01T00:00:00.000Z",
      availableFrom: "2025-05-01T00:00:00.000Z",
      revision: 1,
      metrics: { eps: 130, peRatio: 25, roe: 40 },
    },
    // FY2025 EPS Revision 2 (restatement) — available 2025-08-15
    {
      id: "tcs-2025-a2",
      companyId: "comp-tcs",
      symbol: "TCS",
      periodEnd: "2025-03-31T00:00:00.000Z",
      periodType: "annual",
      filingDate: "2025-08-15T00:00:00.000Z",
      availableFrom: "2025-08-15T00:00:00.000Z",
      revision: 2,
      metrics: { eps: 125, peRatio: 26, roe: 37 }, // restated downward
    },
  ];

  it("1. Look-ahead protection: a 2022 simulation never sees 2023 filing", () => {
    // Backtest on June 1, 2022
    const pit2022 = getPointInTimeFundamentals(mockFundamentals, "2022-06-01T00:00:00.000Z");
    const tcs2022 = pit2022.get("TCS");

    expect(tcs2022).toBeDefined();
    expect(tcs2022?.metrics.eps).toBe(100);
    expect(new Date(tcs2022!.periodEnd).getFullYear()).toBe(2022);

    // Simulation before May 10, 2022 (prior to FY22 filing) sees NO statements
    const pitEarly2022 = getPointInTimeFundamentals(mockFundamentals, "2022-04-01T00:00:00.000Z");
    expect(pitEarly2022.get("TCS")).toBeUndefined();
  });

  it("2. Revision tracking: earlier backtest sees Revision 1; later backtest sees Revision 2", () => {
    // 1. Backtest on June 1, 2025 (after Rev 1 on May 1, but before Rev 2 on Aug 15)
    const pitJune2025 = getPointInTimeFundamentals(mockFundamentals, "2025-06-01T00:00:00.000Z");
    const tcsJune = pitJune2025.get("TCS");
    expect(tcsJune).toBeDefined();
    expect(tcsJune?.revision).toBe(1);
    expect(tcsJune?.metrics.eps).toBe(130);

    // 2. Backtest on September 1, 2025 (after Rev 2 on Aug 15)
    const pitSept2025 = getPointInTimeFundamentals(mockFundamentals, "2025-09-01T00:00:00.000Z");
    const tcsSept = pitSept2025.get("TCS");
    expect(tcsSept).toBeDefined();
    expect(tcsSept?.revision).toBe(2);
    expect(tcsSept?.metrics.eps).toBe(125);
  });

  it("3. Historical universe membership: constituents reflect point-in-time reality", () => {
    const mockMemberships: UniverseConstituent[] = [
      // Old constituent removed on 2022-12-31
      {
        universe: "NIFTY50",
        symbol: "GAIL",
        validFrom: "2018-01-01T00:00:00.000Z",
        validTo: "2022-12-31T23:59:59.000Z",
      },
      // Permanent constituent
      {
        universe: "NIFTY50",
        symbol: "RELIANCE",
        validFrom: "2010-01-01T00:00:00.000Z",
        validTo: null,
      },
      // New constituent added on 2023-01-01
      {
        universe: "NIFTY50",
        symbol: "ADANIENT",
        validFrom: "2023-01-01T00:00:00.000Z",
        validTo: null,
      },
    ];

    // In 2021: GAIL and RELIANCE are members; ADANIENT is NOT
    const members2021 = getActiveUniverseConstituents(mockMemberships, "NIFTY50", "2021-06-01T00:00:00.000Z");
    expect(members2021).toContain("GAIL");
    expect(members2021).toContain("RELIANCE");
    expect(members2021).not.toContain("ADANIENT");

    // In 2024: ADANIENT and RELIANCE are members; GAIL is NOT
    const members2024 = getActiveUniverseConstituents(mockMemberships, "NIFTY50", "2024-06-01T00:00:00.000Z");
    expect(members2024).toContain("ADANIENT");
    expect(members2024).toContain("RELIANCE");
    expect(members2024).not.toContain("GAIL");
  });

  it("4. Survivorship bias detection: generates warning if historical universe data is missing", () => {
    const emptyMemberships: UniverseConstituent[] = [];
    const audit = auditUniverseSurvivorshipBias("NIFTY500", emptyMemberships);

    expect(audit.survivorshipBiasPossible).toBe(true);
    expect(audit.warningCode).toBe("SURVIVORSHIP_BIAS_POSSIBLE");
    expect(audit.message).toContain("Historical universe membership unavailable");
  });
});
