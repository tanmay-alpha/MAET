import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "@/test-utils/memory-storage";
import {
  PAYOFF_LAB_STORAGE_KEY,
  draftFromSearch,
  loadStoredSearch,
  parsePayoffSearch,
  payoffSearchForChainContract,
  searchFromDraft,
  storeSearch,
  validateLab,
  withSymbol,
  visibleContractErrors,
  type LabDraft,
} from "./payoff-lab-state";

function idSequence() {
  let next = 0;
  return () => `leg-${++next}`;
}

const condorDraft: LabDraft = {
  contract: {
    symbol: "NIFTY",
    spot: "24010",
    lotSize: "65",
    strikeStep: "50",
    expiry: "2026-11-17",
    rate: "6.5",
    iv: "14",
  },
  legs: [
    { id: "a", side: "buy", instrument: "PE", strike: "23800", lots: "1", premium: "10" },
    { id: "b", side: "sell", instrument: "PE", strike: "23900", lots: "1", premium: "30" },
    { id: "c", side: "sell", instrument: "CE", strike: "24100", lots: "1", premium: "32.5" },
    { id: "d", side: "buy", instrument: "CE", strike: "24200", lots: "1", premium: "" },
  ],
  ivShift: 2,
};

describe("payoff lab URL state", () => {
  it("round-trips contract inputs and legs, keeping blank premiums blank", () => {
    const search = searchFromDraft(condorDraft);

    expect(search).toEqual({
      sym: "NIFTY",
      spot: 24010,
      lot: 65,
      step: 50,
      exp: "2026-11-17",
      r: 6.5,
      iv: 14,
      legs: "B_PE_23800_1_10~S_PE_23900_1_30~S_CE_24100_1_32.5~B_CE_24200_1_",
      ivs: 2,
    });
    const restored = draftFromSearch(parsePayoffSearch({ ...search }), idSequence());
    expect(restored.contract).toEqual(condorDraft.contract);
    expect(restored.ivShift).toBe(2);
    expect(restored.legs.map(({ id: _id, ...leg }) => leg)).toEqual(condorDraft.legs.map(({ id: _id, ...leg }) => leg));
  });

  it("drops search values that fail validation instead of rejecting the page", () => {
    expect(
      parsePayoffSearch({
        sym: "nifty",
        spot: -5,
        lot: 6.5,
        step: "abc",
        exp: "next week",
        r: 6.5,
        iv: 900,
        legs: "B_CE_24000_1_120~X_CE_1_1_1~S_ZZ_1_1_1~S_PE_23,000_1_5",
        ivs: 40,
        unrelated: "kept out",
      }),
    ).toEqual({ sym: "NIFTY", r: 6.5, legs: "B_CE_24000_1_120~X_CE_1_1_1~S_ZZ_1_1_1~S_PE_23,000_1_5" });

    const draft = draftFromSearch({ legs: "B_CE_24000_1_120~X_CE_1_1_1~S_ZZ_1_1_1~S_PE_23,000_1_5" }, idSequence());
    expect(draft.legs).toEqual([
      { id: "leg-1", side: "buy", instrument: "CE", strike: "24000", lots: "1", premium: "120" },
      { id: "leg-2", side: "sell", instrument: "PE", strike: "", lots: "1", premium: "5" },
    ]);
  });

  it("omits blank inputs from the URL rather than writing zeros", () => {
    const search = searchFromDraft({
      ...condorDraft,
      contract: { ...condorDraft.contract, spot: "", rate: "" },
      legs: [],
      ivShift: 0,
    });

    expect(search).toEqual({ sym: "NIFTY", lot: 65, step: 50, exp: "2026-11-17", iv: 14 });
  });

  it("starts a fresh lab with the NSE index defaults, a 6.5% rate and 14% IV", () => {
    expect(draftFromSearch({}, idSequence())).toEqual({
      contract: { symbol: "NIFTY", spot: "", lotSize: "65", strikeStep: "50", expiry: "", rate: "6.5", iv: "14" },
      legs: [],
      ivShift: 0,
    });
    expect(draftFromSearch({ sym: "BANKNIFTY" }, idSequence()).contract).toMatchObject({ lotSize: "30", strikeStep: "100" });
  });

  it("switches lot size and strike step with a known index and leaves them alone for other symbols", () => {
    const banknifty = withSymbol(condorDraft.contract, "banknifty");
    expect(banknifty).toMatchObject({ symbol: "BANKNIFTY", lotSize: "30", strikeStep: "100" });
    expect(withSymbol(banknifty, "RELIANCE")).toMatchObject({ symbol: "RELIANCE", lotSize: "30", strikeStep: "100" });
  });
});

describe("payoff lab session storage", () => {
  it("restores the last session and ignores corrupt entries", () => {
    const storage = new MemoryStorage();
    expect(loadStoredSearch(storage)).toBeNull();

    storeSearch(storage, searchFromDraft(condorDraft));
    expect(loadStoredSearch(storage)).toEqual(searchFromDraft(condorDraft));

    storage.setItem(PAYOFF_LAB_STORAGE_KEY, "{not json");
    expect(loadStoredSearch(storage)).toBeNull();
  });
});

describe("payoff lab validation", () => {
  it("turns a complete draft into priced legs with decimal rate and volatility", () => {
    const result = validateLab({ ...condorDraft, legs: condorDraft.legs.slice(0, 3) }, "2026-11-07");

    expect(result.contractErrors).toEqual({});
    expect(result.legErrors).toEqual({});
    expect(result.daysToExpiry).toBe(10);
    expect(result.lab).toEqual({
      symbol: "NIFTY",
      spot: 24_010,
      lotSize: 65,
      strikeStep: 50,
      daysToExpiry: 10,
      rate: 0.065,
      volatility: 0.14,
      legs: [
        { side: "buy", instrument: "PE", strike: 23_800, lots: 1, premium: 10 },
        { side: "sell", instrument: "PE", strike: 23_900, lots: 1, premium: 30 },
        { side: "sell", instrument: "CE", strike: 24_100, lots: 1, premium: 32.5 },
      ],
    });
  });

  it("reports every missing input and withholds the analysis until they are fixed", () => {
    const result = validateLab(
      {
        ...condorDraft,
        contract: { ...condorDraft.contract, spot: "", lotSize: "2.5", expiry: "2026-11-01" },
        legs: [...condorDraft.legs, { id: "e", side: "buy", instrument: "FUT", strike: "24010", lots: "0", premium: "" }],
      },
      "2026-11-07",
    );

    expect(result.lab).toBeNull();
    expect(result.contractErrors).toEqual({
      spot: "Enter spot > 0",
      lotSize: "Whole number > 0",
      expiry: "Expiry is in the past",
    });
    expect(result.legErrors).toEqual({ d: { premium: "Enter premium" }, e: { lots: "Whole number > 0" } });
  });

  it("shows no error on a field the user has not filled yet, but keeps invalid entries flagged", () => {
    const contract = { ...condorDraft.contract, spot: "", lotSize: "2.5" };
    const { contractErrors } = validateLab({ ...condorDraft, contract }, "2026-11-07");
    expect(contractErrors.spot).toBe("Enter spot > 0");
    expect(visibleContractErrors(contract, contractErrors)).toEqual({ lotSize: "Whole number > 0" });
  });
});

describe("options chain hand-off", () => {
  it("pre-fills the underlying, spot, contract and the clicked strike as a bought leg", () => {
    expect(
      payoffSearchForChainContract({
        underlying: "NIFTY",
        spot: 24_012.35,
        expiry: "2026-11-17",
        lotSize: 65,
        impliedVolatility: 13.8,
        leg: { instrument: "CE", strike: "24100.00", premium: "84.05" },
      }),
    ).toEqual({
      sym: "NIFTY",
      spot: 24_012.35,
      lot: 65,
      step: 50,
      exp: "2026-11-17",
      iv: 13.8,
      legs: "B_CE_24100_1_84.05",
    });
  });

  it("still links with a blank premium when the chain has no quote", () => {
    expect(
      payoffSearchForChainContract({
        underlying: "RELIANCE",
        leg: { instrument: "PE", strike: "1300.00", premium: null },
      }),
    ).toEqual({ sym: "RELIANCE", legs: "B_PE_1300_1_" });
  });
});
