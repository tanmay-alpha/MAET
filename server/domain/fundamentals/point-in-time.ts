/**
 * Point-in-Time Fundamentals and Universe Membership Engine — MAET P2.
 *
 * Guarantees zero look-ahead bias and zero survivorship bias in quantitative research:
 * 1. available_from <= T invariant: Historical simulations can only access financial statements
 *    that were publicly filed and available on or before simulation timestamp T.
 * 2. Revision tracking: Preserves financial restatements (Revision 1 vs Revision 2). Earlier
 *    dates see Revision 1; dates after restatement see Revision 2.
 * 3. Historical universe membership: Queries active constituents valid at timestamp T rather
 *    than today's surviving universe.
 * 4. Structured warning emission: Emits SURVIVORSHIP_BIAS_POSSIBLE if historical index
 *    membership history is unavailable.
 */

export interface PointInTimeFundamentalMetrics {
  eps?: number;
  peRatio?: number;
  forwardPe?: number;
  pbRatio?: number;
  roe?: number;
  roce?: number;
  revenue?: number;
  netIncome?: number;
  debtToEquity?: number;
  bookValuePerShare?: number;
  marketCap?: number;
  freeCashFlow?: number;
  operatingMargin?: number;
  netMargin?: number;
  currentRatio?: number;
  dividendYield?: number;
}

export interface PointInTimeFundamental {
  id: string;
  companyId: string;
  symbol: string;
  periodEnd: string | Date;
  periodType: "quarterly" | "annual";
  filingDate: string | Date;
  availableFrom: string | Date;
  ingestedAt?: string | Date;
  revision: number;
  metrics: PointInTimeFundamentalMetrics;
}

export interface UniverseConstituent {
  id?: string;
  universe: string;
  symbol: string;
  companyId?: string;
  validFrom: string | Date;
  validTo?: string | Date | null;
  source?: string;
}

export interface UniverseAuditResult {
  survivorshipBiasPossible: boolean;
  warningCode?: "SURVIVORSHIP_BIAS_POSSIBLE";
  message?: string;
  constituentCount: number;
}

/**
 * Retrieves the point-in-time state of fundamentals as of timestamp T.
 * Strict Invariants:
 * 1. Only statements with availableFrom <= asOf are visible.
 * 2. For restatements / multiple revisions of the same period, only the latest revision
 *    satisfying availableFrom <= asOf is used.
 * 3. Returns a map keyed by symbol (or companyId) containing only valid point-in-time values.
 */
export function getPointInTimeFundamentals(
  records: PointInTimeFundamental[],
  asOf: string | number | Date,
): Map<string, PointInTimeFundamental> {
  const asOfMs = new Date(asOf).getTime();
  const resultMap = new Map<string, PointInTimeFundamental>();

  // Filter only records that were available on or before asOf timestamp
  const visible = records.filter((r) => new Date(r.availableFrom).getTime() <= asOfMs);

  // Group by symbol + periodEnd + periodType to find the latest valid revision for each period
  const periodMap = new Map<string, PointInTimeFundamental>();

  for (const r of visible) {
    const periodKey = `${r.symbol}:${r.periodType}:${new Date(r.periodEnd).toISOString().slice(0, 10)}`;
    const existing = periodMap.get(periodKey);

    if (!existing) {
      periodMap.set(periodKey, r);
    } else {
      // Pick higher revision, or if same revision pick latest availableFrom
      if (
        r.revision > existing.revision ||
        (r.revision === existing.revision &&
          new Date(r.availableFrom).getTime() > new Date(existing.availableFrom).getTime())
      ) {
        periodMap.set(periodKey, r);
      }
    }
  }

  // Now, for each symbol, select the latest available periodEnd
  for (const r of periodMap.values()) {
    const existingForSymbol = resultMap.get(r.symbol);
    if (!existingForSymbol) {
      resultMap.set(r.symbol, r);
    } else {
      const existingPeriodMs = new Date(existingForSymbol.periodEnd).getTime();
      const currentPeriodMs = new Date(r.periodEnd).getTime();
      if (currentPeriodMs > existingPeriodMs) {
        resultMap.set(r.symbol, r);
      }
    }
  }

  return resultMap;
}

/**
 * Returns active constituents of a universe as of timestamp T.
 */
export function getActiveUniverseConstituents(
  memberships: UniverseConstituent[],
  universe: string,
  asOf: string | number | Date,
): string[] {
  const asOfMs = new Date(asOf).getTime();
  const normalizedUni = universe.trim().toUpperCase();

  const activeSymbols = new Set<string>();

  for (const m of memberships) {
    if (m.universe.trim().toUpperCase() !== normalizedUni) continue;

    const fromMs = new Date(m.validFrom).getTime();
    const toMs = m.validTo ? new Date(m.validTo).getTime() : Infinity;

    if (asOfMs >= fromMs && asOfMs <= toMs) {
      activeSymbols.add(m.symbol);
    }
  }

  return Array.from(activeSymbols).sort();
}

/**
 * Audits whether a universe backtest has historical point-in-time membership data,
 * flagging SURVIVORSHIP_BIAS_POSSIBLE if missing.
 */
export function auditUniverseSurvivorshipBias(
  universe: string,
  memberships: UniverseConstituent[],
  asOf?: string | number | Date,
): UniverseAuditResult {
  const normalizedUni = universe.trim().toUpperCase();
  const matching = memberships.filter((m) => m.universe.trim().toUpperCase() === normalizedUni);

  if (matching.length === 0) {
    return {
      survivorshipBiasPossible: true,
      warningCode: "SURVIVORSHIP_BIAS_POSSIBLE",
      message: `Historical universe membership unavailable for universe '${universe}'. Test executed using static constituents; survivorship bias is possible.`,
      constituentCount: 0,
    };
  }

  const active = asOf ? getActiveUniverseConstituents(matching, universe, asOf) : matching.map((m) => m.symbol);

  return {
    survivorshipBiasPossible: false,
    constituentCount: active.length,
  };
}
