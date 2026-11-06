/**
 * Payoff Lab state: the editable draft the form holds, its URL search form (shareable),
 * the last-session copy in localStorage, and validation into priced legs.
 *
 * Inputs stay strings while the user types; only validated numbers reach the URL, and a
 * leg's fields are kept as typed so a template with blank premiums survives a reload.
 */
import { z } from "zod";
import { indexContractDefaults } from "@shared/domain/options/index-contracts";
import type { Instrument, Leg, Side } from "@shared/domain/options/payoff";

export const PAYOFF_LAB_STORAGE_KEY = "maet:payoff-lab";
export const DEFAULT_SYMBOL = "NIFTY";
export const DEFAULT_RATE_PCT = 6.5;
export const DEFAULT_IV_PCT = 14;
export const MAX_LEGS = 12;
export const IV_SHIFT_LIMIT = 10;

export interface ContractDraft {
  symbol: string;
  spot: string;
  lotSize: string;
  strikeStep: string;
  /** ISO date, YYYY-MM-DD. */
  expiry: string;
  /** Percent. */
  rate: string;
  /** Percent. */
  iv: string;
}

export interface LegDraft {
  id: string;
  side: Side;
  instrument: Instrument;
  strike: string;
  lots: string;
  premium: string;
}

export interface LabDraft {
  contract: ContractDraft;
  legs: LegDraft[];
  /** Volatility points added to the IV for the today curve and the scenario grid. */
  ivShift: number;
}

export type ContractErrors = Partial<Record<keyof ContractDraft, string>>;
export type LegErrors = Partial<Record<"strike" | "lots" | "premium", string>>;

export interface ValidLab {
  symbol: string;
  spot: number;
  lotSize: number;
  strikeStep: number;
  daysToExpiry: number;
  /** Decimal. */
  rate: number;
  /** Decimal, before any IV shift. */
  volatility: number;
  legs: Leg[];
}

export interface LabValidation {
  contractErrors: ContractErrors;
  legErrors: Record<string, LegErrors>;
  daysToExpiry: number | null;
  /** Present only when every input is valid and there is at least one leg. */
  lab: ValidLab | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_DRAFT = /^\d{0,9}(\.\d{0,4})?$/;

const payoffSearchSchema = z.object({
  sym: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9&.-]{1,20}$/)
    .optional()
    .catch(undefined),
  spot: z.coerce.number().finite().positive().optional().catch(undefined),
  lot: z.coerce.number().int().positive().optional().catch(undefined),
  step: z.coerce.number().finite().positive().optional().catch(undefined),
  exp: z.string().regex(ISO_DATE).optional().catch(undefined),
  r: z.coerce.number().min(0).max(50).optional().catch(undefined),
  iv: z.coerce.number().positive().max(300).optional().catch(undefined),
  legs: z.string().max(MAX_LEGS * 48).optional().catch(undefined),
  ivs: z.coerce.number().min(-IV_SHIFT_LIMIT).max(IV_SHIFT_LIMIT).optional().catch(undefined),
});

export type PayoffSearch = z.infer<typeof payoffSearchSchema>;

/** The route's search schema: invalid values are dropped, never thrown. */
export function parsePayoffSearch(search: Record<string, unknown>): PayoffSearch {
  return payoffSearchSchema.parse(search);
}

// Legs travel as "B_CE_24000_1_120~S_PE_23800_1_": side, instrument, strike, lots, premium.
const SIDE_CODE = { buy: "B", sell: "S" } as const;

function encodeLegs(legs: ReadonlyArray<Omit<LegDraft, "id">>): string | undefined {
  if (legs.length === 0) return undefined;
  return legs
    .slice(0, MAX_LEGS)
    .map((leg) =>
      [SIDE_CODE[leg.side], leg.instrument, leg.strike, leg.lots, leg.instrument === "FUT" ? "" : leg.premium].join("_"),
    )
    .join("~");
}

function decodeLegs(encoded: string | undefined): Array<Omit<LegDraft, "id">> {
  if (!encoded) return [];
  const numeric = (value: string) => (NUMERIC_DRAFT.test(value) ? value : "");
  return encoded
    .split("~")
    .slice(0, MAX_LEGS)
    .flatMap((part) => {
      const [side, instrument, strike = "", lots = "", premium = ""] = part.split("_");
      if ((side !== "B" && side !== "S") || (instrument !== "CE" && instrument !== "PE" && instrument !== "FUT")) {
        return [];
      }
      return [
        {
          side: side === "B" ? ("buy" as const) : ("sell" as const),
          instrument,
          strike: numeric(strike),
          lots: numeric(lots),
          premium: instrument === "FUT" ? "" : numeric(premium),
        },
      ];
    });
}

const toDraft = (value: number | undefined) => (value === undefined ? "" : String(value));

export function draftFromSearch(search: PayoffSearch, newLegId: () => string): LabDraft {
  const symbol = search.sym ?? DEFAULT_SYMBOL;
  const defaults = indexContractDefaults(symbol);
  return {
    contract: {
      symbol,
      spot: toDraft(search.spot),
      lotSize: toDraft(search.lot ?? defaults?.lotSize),
      strikeStep: toDraft(search.step ?? defaults?.strikeStep),
      expiry: search.exp ?? "",
      rate: toDraft(search.r ?? DEFAULT_RATE_PCT),
      iv: toDraft(search.iv ?? DEFAULT_IV_PCT),
    },
    legs: decodeLegs(search.legs).map((leg) => ({ ...leg, id: newLegId() })),
    ivShift: search.ivs ?? 0,
  };
}

export function searchFromDraft({ contract, legs, ivShift }: LabDraft): PayoffSearch {
  const typed = (value: string) => (value.trim() === "" ? undefined : value);
  return parsePayoffSearch({
    sym: typed(contract.symbol),
    spot: typed(contract.spot),
    lot: typed(contract.lotSize),
    step: typed(contract.strikeStep),
    exp: typed(contract.expiry),
    r: typed(contract.rate),
    iv: typed(contract.iv),
    legs: encodeLegs(legs),
    ivs: ivShift === 0 ? undefined : ivShift,
  });
}

/** Changing the underlying to a known index also switches its lot size and strike step. */
export function withSymbol(contract: ContractDraft, symbol: string): ContractDraft {
  const normalized = symbol.trim().toUpperCase();
  const defaults = indexContractDefaults(normalized);
  return defaults
    ? { ...contract, symbol: normalized, lotSize: String(defaults.lotSize), strikeStep: String(defaults.strikeStep) }
    : { ...contract, symbol: normalized };
}

export function loadStoredSearch(storage: Storage): PayoffSearch | null {
  const stored = storage.getItem(PAYOFF_LAB_STORAGE_KEY);
  if (stored === null) return null;
  try {
    const value: unknown = JSON.parse(stored);
    return value !== null && typeof value === "object" ? parsePayoffSearch(value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function storeSearch(storage: Storage, search: PayoffSearch): void {
  storage.setItem(PAYOFF_LAB_STORAGE_KEY, JSON.stringify(search));
}

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const DAY_MS = 86_400_000;

function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** `today` is the viewer's local date (YYYY-MM-DD); null until the browser has rendered. */
export function validateLab(draft: LabDraft, today: string | null): LabValidation {
  const { contract } = draft;
  const spot = parseNumber(contract.spot);
  const lotSize = parseNumber(contract.lotSize);
  const strikeStep = parseNumber(contract.strikeStep);
  const rate = parseNumber(contract.rate);
  const iv = parseNumber(contract.iv);
  const daysToExpiry = today !== null && ISO_DATE.test(contract.expiry) ? calendarDaysBetween(today, contract.expiry) : null;

  const contractErrors: ContractErrors = {};
  if (contract.symbol.trim() === "") contractErrors.symbol = "Required";
  if (spot === null || spot <= 0) contractErrors.spot = "Enter spot > 0";
  if (lotSize === null || lotSize <= 0 || !Number.isInteger(lotSize)) contractErrors.lotSize = "Whole number > 0";
  if (strikeStep === null || strikeStep <= 0) contractErrors.strikeStep = "Enter a step > 0";
  if (!ISO_DATE.test(contract.expiry)) contractErrors.expiry = "Pick an expiry";
  else if (daysToExpiry !== null && daysToExpiry < 0) contractErrors.expiry = "Expiry is in the past";
  if (rate === null || rate < 0 || rate > 50) contractErrors.rate = "0 to 50";
  if (iv === null || iv <= 0 || iv > 300) contractErrors.iv = "Above 0, up to 300";

  const legErrors: Record<string, LegErrors> = {};
  const legs: Leg[] = [];
  for (const draftLeg of draft.legs) {
    const errors: LegErrors = {};
    const strike = parseNumber(draftLeg.strike);
    const lots = parseNumber(draftLeg.lots);
    const premium = draftLeg.instrument === "FUT" ? 0 : parseNumber(draftLeg.premium);
    if (strike === null || strike <= 0) errors.strike = draftLeg.instrument === "FUT" ? "Enter entry" : "Enter strike";
    if (lots === null || lots <= 0 || !Number.isInteger(lots)) errors.lots = "Whole number > 0";
    if (premium === null || premium < 0) errors.premium = "Enter premium";
    if (Object.keys(errors).length > 0) {
      legErrors[draftLeg.id] = errors;
    } else {
      legs.push({ side: draftLeg.side, instrument: draftLeg.instrument, strike: strike!, lots: lots!, premium: premium! });
    }
  }

  const complete =
    Object.keys(contractErrors).length === 0 &&
    Object.keys(legErrors).length === 0 &&
    legs.length > 0 &&
    daysToExpiry !== null;

  return {
    contractErrors,
    legErrors,
    daysToExpiry,
    lab: complete
      ? {
          symbol: contract.symbol.trim().toUpperCase(),
          spot: spot!,
          lotSize: lotSize!,
          strikeStep: strikeStep!,
          daysToExpiry: daysToExpiry!,
          rate: rate! / 100,
          volatility: iv! / 100,
          legs,
        }
      : null,
  };
}

export interface ChainContractLink {
  underlying: string;
  spot?: number | null;
  expiry?: string | null;
  lotSize?: number | null;
  /** Percent, as the chain reports it. */
  impliedVolatility?: number | null;
  leg?: { instrument: "CE" | "PE"; strike: string; premium: string | null };
}

/**
 * Search params that open the lab on one chain contract. The chain's last price becomes an
 * editable premium; a contract without a quote opens with the premium blank.
 */
export function payoffSearchForChainContract(link: ChainContractLink): PayoffSearch {
  const symbol = link.underlying.trim().toUpperCase();
  const strike = link.leg ? Number(link.leg.strike) : Number.NaN;
  const premium = link.leg?.premium == null ? Number.NaN : Number(link.leg.premium);
  return parsePayoffSearch({
    sym: symbol,
    spot: link.spot ?? undefined,
    lot: link.lotSize ?? undefined,
    step: indexContractDefaults(symbol)?.strikeStep,
    exp: link.expiry ?? undefined,
    iv: link.impliedVolatility || undefined,
    legs:
      link.leg && strike > 0
        ? encodeLegs([
            {
              side: "buy",
              instrument: link.leg.instrument,
              strike: String(strike),
              lots: "1",
              premium: premium >= 0 ? String(premium) : "",
            },
          ])
        : undefined,
  });
}
