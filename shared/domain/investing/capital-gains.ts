export interface Fill {
  id: string;
  generation: number;
  symbol: string;
  exchange: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  /** Server-supplied IST calendar date, YYYY-MM-DD. Input order breaks same-date ties. */
  date: string;
  /** Optional supplied charge, deliberately not deducted by this gross-price estimator. */
  fee?: number;
}

export interface MatchedLot {
  entryFillId: string;
  exitFillId: string;
  generation: number;
  symbol: string;
  exchange: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  side: "LONG" | "SHORT";
  grossPnl: number;
  /** short means an overnight short, not a short-term capital gain. */
  kind: "delivery" | "intraday" | "short";
}

export interface CapitalGainsBucket {
  term: "STCG" | "LTCG";
  regime: "old" | "new";
  rate: number;
  grossGains: number;
  /** Positive magnitude of losses in this bucket. */
  grossLosses: number;
  /** grossGains - grossLosses, before cross-bucket setoff. */
  netGain: number;
  /** Loss transferred from another rate bucket; internal netting is already in netGain. */
  lossOffset: number;
  exemptionUsed: number;
  taxableGain: number;
  tax: number;
}

export interface CapitalGainsReport {
  financialYearStart: number;
  startDate: string;
  endDate: string;
  generation: number;
  /** Only rounds whose exit is inside this FY; entries may precede it. */
  matchedLots: MatchedLot[];
  /** Signed delivery P&L by holding period, before cross-term setoff/exemption. */
  grossStcg: number;
  grossLtcg: number;
  exemptionLimit: number;
  exemptionUsed: number;
  buckets: CapitalGainsBucket[];
  baseTax: number;
  cess: number;
  estimatedTax: number;
  intradayPnl: number;
  intradayTurnover: number;
  overnightShortPnl: number;
  /** Unabsorbed current-year losses, not a determination of carry-forward eligibility. */
  unabsorbedStcl: number;
  unabsorbedLtcl: number;
  assumptions: string[];
}

interface OpenLot {
  fill: Fill;
  remaining: number;
}

interface LotQueue {
  lots: OpenLot[];
  head: number;
}

/** Consumes opposing FIFO lots, then retains any unmatched incoming quantity. */
function matchAgainstQueue(incoming: OpenLot, queue: LotQueue, matched: MatchedLot[]) {
  const fill = incoming.fill;
  while (incoming.remaining > 0 && queue.head < queue.lots.length) {
    const entry = queue.lots[queue.head]!;
    if (entry.fill.side === fill.side) break;
    const quantity = Math.min(entry.remaining, incoming.remaining);
    const side = entry.fill.side === "BUY" ? "LONG" : "SHORT";
    matched.push({
      entryFillId: entry.fill.id,
      exitFillId: fill.id,
      generation: fill.generation,
      symbol: fill.symbol,
      exchange: fill.exchange,
      entryDate: entry.fill.date,
      exitDate: fill.date,
      entryPrice: entry.fill.price,
      exitPrice: fill.price,
      quantity,
      side,
      grossPnl: quantity * (side === "LONG" ? fill.price - entry.fill.price : entry.fill.price - fill.price),
      kind: entry.fill.date === fill.date ? "intraday" : side === "SHORT" ? "short" : "delivery",
    });
    // Remove floating subtraction dust relative to the quantities involved,
    // without imposing a minimum trade quantity on fractional holdings.
    const tolerance = Number.EPSILON * 4 * Math.max(entry.remaining, incoming.remaining);
    entry.remaining -= quantity;
    incoming.remaining -= quantity;
    if (entry.remaining <= tolerance) {
      entry.remaining = 0;
      queue.head += 1;
    }
    if (incoming.remaining <= tolerance) incoming.remaining = 0;
  }
  if (incoming.remaining > 0) queue.lots.push(incoming);
}

/**
 * FIFO is isolated by generation/exchange/symbol. Opposing fills first square
 * off within each IST day, preserving execution order (including short-first
 * rounds). Only unmatched day quantities consume or enter historical FIFO.
 * A residual crossing zero closes existing lots, then opens the opposite side.
 * Unclosed quantities are unrealised. This daily-netting convention substitutes
 * for unavailable product/settlement metadata; it is not a legal FIFO assertion.
 */
export function matchFifoLots(fills: readonly Fill[], generation: number): MatchedLot[] {
  return matchFifoPositions(fills, generation).matched;
}

/** An unmatched FIFO remainder: still held (LONG) or still owed (SHORT). */
export interface OpenFifoLot {
  fillId: string;
  symbol: string;
  exchange: string;
  side: "LONG" | "SHORT";
  date: string;
  price: number;
  quantity: number;
}

/** matchFifoLots plus the open lots left in each queue, oldest first per symbol. */
export function matchFifoPositions(fills: readonly Fill[], generation: number): { matched: MatchedLot[]; open: OpenFifoLot[] } {
  const ordered = fills.filter((fill) => fill.generation === generation);
  ordered.sort((left, right) => left.date.localeCompare(right.date));
  const queues = new Map<string, LotQueue>();
  const matched: MatchedLot[] = [];
  let cursor = 0;
  while (cursor < ordered.length) {
    const date = ordered[cursor]!.date;
    const dayQueues = new Map<string, LotQueue>();
    while (cursor < ordered.length && ordered[cursor]!.date === date) {
      const fill = ordered[cursor]!;
      // A JSON tuple avoids delimiter collisions in exchange/symbol identifiers.
      const key = JSON.stringify([fill.exchange, fill.symbol]);
      let queue = dayQueues.get(key);
      if (!queue) {
        queue = { lots: [], head: 0 };
        dayQueues.set(key, queue);
      }
      matchAgainstQueue({ fill, remaining: fill.quantity }, queue, matched);
      cursor += 1;
    }
    for (const [key, dayQueue] of dayQueues) {
      let queue = queues.get(key);
      if (!queue) {
        queue = { lots: [], head: 0 };
        queues.set(key, queue);
      }
      for (let index = dayQueue.head; index < dayQueue.lots.length; index += 1) {
        matchAgainstQueue(dayQueue.lots[index]!, queue, matched);
      }
    }
  }
  const open: OpenFifoLot[] = [];
  for (const queue of queues.values()) {
    for (let index = queue.head; index < queue.lots.length; index += 1) {
      const { fill, remaining } = queue.lots[index]!;
      open.push({ fillId: fill.id, symbol: fill.symbol, exchange: fill.exchange, side: fill.side === "BUY" ? "LONG" : "SHORT", date: fill.date, price: fill.price, quantity: remaining });
    }
  }
  return { matched, open };
}

/**
 * Twelve calendar months after entryDate (YYYY-MM-DD). Selling on this date is
 * still short-term; LTCG needs a later exit. Feb 29 clamps to Feb 28.
 */
export function twelveMonthAnniversary(entryDate: string): string {
  return `${Number(entryDate.slice(0, 4)) + 1}-${entryDate.slice(5) === "02-29" ? "02-28" : entryDate.slice(5)}`;
}

/**
 * Primary law (Income Tax Department, including its 2026 consolidated text):
 * s111A: https://wm.incometaxindia.gov.in/w/section-111a
 * s112A: https://wm.incometaxindia.gov.in/w/section-112a-65
 * 2024 amendment and prior wording: https://wm.incometaxindia.gov.in/w/section-112a-59
 * s70(2),(3): https://wm.incometaxindia.gov.in/w/section-70-128
 * s2(42A), listed equity twelve-month threshold: https://www.incometaxindia.gov.in/w/section-2-57
 * s43(5), non-delivery/speculation: https://www.incometaxindia.gov.in/w/section-43-5
 * s48, expenses/cost and STT exclusion: https://www.incometaxindia.gov.in/w/section-48-65
 *
 * Transfers before 2024-07-23 use 15% ST / 10% LT; that day and later use
 * 20% / 12.5%. The amended s112A(2)(i) proviso explicitly makes ₹125,000
 * one aggregate limit over BOTH rate groups, hence the whole FY2024-25,
 * including a portfolio with only pre-change exits. Earlier FYs use ₹100,000.
 * Department rate/cess table (4% on tax plus surcharge; surcharge is omitted here):
 * https://wmstatic-prd.incometaxindia.gov.in/documents/20117/42998/Tax-rates%E2%80%8B_2026-01-22_11-20-48_540e32_en.pdf/021c2f6a-881c-f666-3449-ccf0bcc172b8
 *
 * Deterministic allocation, not a tax-minimisation claim:
 * 1. net positive and negative rounds within each term/rate bucket;
 * 2. pool remaining LT losses and offset LT old then LT new;
 * 3. pool remaining ST losses and offset ST old, ST new, LT old, LT new;
 * 4. consume the annual LT exemption in LT old then LT new.
 * Thus each transfer can be traced: taxable = max(netGain,0) - lossOffset
 * - exemptionUsed. s70 allows STCL against ST/LT and LTCL only against LT;
 * the specific allocation ordering above is an estimator convention, not law.
 */
export function buildCapitalGainsReport(fills: readonly Fill[], financialYearStart: number, generation: number): CapitalGainsReport {
  const startDate = `${financialYearStart}-04-01`;
  const endDate = `${financialYearStart + 1}-03-31`;
  const matchedLots = matchFifoLots(fills, generation).filter((lot) => lot.exitDate >= startDate && lot.exitDate <= endDate);
  const buckets: CapitalGainsBucket[] = [
    { term: "STCG", regime: "old", rate: 0.15, grossGains: 0, grossLosses: 0, netGain: 0, lossOffset: 0, exemptionUsed: 0, taxableGain: 0, tax: 0 },
    { term: "STCG", regime: "new", rate: 0.2, grossGains: 0, grossLosses: 0, netGain: 0, lossOffset: 0, exemptionUsed: 0, taxableGain: 0, tax: 0 },
    { term: "LTCG", regime: "old", rate: 0.1, grossGains: 0, grossLosses: 0, netGain: 0, lossOffset: 0, exemptionUsed: 0, taxableGain: 0, tax: 0 },
    { term: "LTCG", regime: "new", rate: 0.125, grossGains: 0, grossLosses: 0, netGain: 0, lossOffset: 0, exemptionUsed: 0, taxableGain: 0, tax: 0 },
  ];
  let intradayPnl = 0;
  let intradayTurnover = 0;
  let overnightShortPnl = 0;
  for (const lot of matchedLots) {
    if (lot.kind === "intraday") {
      intradayPnl += lot.grossPnl;
      intradayTurnover += Math.abs(lot.grossPnl);
      continue;
    }
    if (lot.kind === "short") {
      overnightShortPnl += lot.grossPnl;
      continue;
    }
    // Calendar months, not 365 days: exact first anniversary is still short-term.
    const longTerm = lot.exitDate > twelveMonthAnniversary(lot.entryDate);
    const newRate = lot.exitDate >= "2024-07-23";
    const bucket = buckets[(longTerm ? 2 : 0) + (newRate ? 1 : 0)]!;
    if (lot.grossPnl >= 0) bucket.grossGains += lot.grossPnl;
    else bucket.grossLosses -= lot.grossPnl;
  }

  let unabsorbedStcl = 0;
  let unabsorbedLtcl = 0;
  let grossStcg = 0;
  let grossLtcg = 0;
  for (const bucket of buckets) {
    bucket.netGain = bucket.grossGains - bucket.grossLosses;
    bucket.taxableGain = Math.max(bucket.netGain, 0);
    if (bucket.term === "STCG") {
      grossStcg += bucket.netGain;
      unabsorbedStcl += Math.max(-bucket.netGain, 0);
    } else {
      grossLtcg += bucket.netGain;
      unabsorbedLtcl += Math.max(-bucket.netGain, 0);
    }
  }
  for (const bucket of buckets) {
    if (bucket.term !== "LTCG") continue;
    const offset = Math.min(unabsorbedLtcl, bucket.taxableGain);
    bucket.lossOffset += offset;
    bucket.taxableGain -= offset;
    unabsorbedLtcl -= offset;
  }
  for (const bucket of buckets) {
    const offset = Math.min(unabsorbedStcl, bucket.taxableGain);
    bucket.lossOffset += offset;
    bucket.taxableGain -= offset;
    unabsorbedStcl -= offset;
  }
  const exemptionLimit = financialYearStart < 2024 ? 100000 : 125000;
  let exemptionRemaining = exemptionLimit;
  let baseTax = 0;
  for (const bucket of buckets) {
    if (bucket.term === "LTCG") {
      bucket.exemptionUsed = Math.min(exemptionRemaining, bucket.taxableGain);
      bucket.taxableGain -= bucket.exemptionUsed;
      exemptionRemaining -= bucket.exemptionUsed;
    }
    bucket.tax = bucket.taxableGain * bucket.rate;
    baseTax += bucket.tax;
  }
  const cess = baseTax * 0.04;
  return {
    financialYearStart,
    startDate,
    endDate,
    generation,
    matchedLots,
    grossStcg,
    grossLtcg,
    exemptionLimit,
    exemptionUsed: exemptionLimit - exemptionRemaining,
    buckets,
    baseTax,
    cess,
    estimatedTax: baseTax + cess,
    intradayPnl,
    intradayTurnover,
    overnightShortPnl,
    unabsorbedStcl,
    unabsorbedLtcl,
    assumptions: [
      "Paper estimate only, not tax advice. INR listed Indian equity held as investment; sections 111A/112A qualifying STT conditions are assumed satisfied, not established by paper fills.",
      "Dates are server-supplied IST YYYY-MM-DD. FY is April 1 through March 31 by exit date; all supplied entry history is used. Same-date fills retain input execution order. Only the selected generation is included.",
      "FIFO is per exchange and symbol. In the absence of product/settlement metadata, opposing same-day fills square off first as speculative intraday in execution order, including short-first rounds; only unmatched day quantities enter or consume historical FIFO inventory. Overnight shorts are separate non-delivery business P&L, excluded from delivery capital gains.",
      "Intraday turnover is the sum of absolute matched-round profits and losses, not traded notional or a determination of tax-audit applicability. Intraday and overnight-short business taxes/loss setoffs are not computed.",
      "STCG includes exactly twelve calendar months; LTCG requires more than twelve months. The first anniversary of February 29 is February 28. Unmatched open lots are unrealised and excluded.",
      "Gross price P&L only: supplied fees, brokerage, STT and other charges are not deducted under the requested simplification. This is not a claim that all brokerage or transfer expenses are legally nondeductible; section 48 has its own rules and excludes STT.",
      "Each term/rate bucket is internally netted first; remaining LTCL offsets LT old then new; remaining STCL offsets ST old, ST new, LT old, LT new. The exemption offsets LT old then new. This deterministic convention is not an optimal tax allocation claim.",
      "The LTCG exemption is shared across the FY: 100000 before FY2024-25, 125000 from FY2024-25, including its pre-July-23 gains. Rates change on July 23, 2024, not at the FY boundary.",
      "Only supplied current-FY capital losses and gains are considered: no external holdings, brought-forward losses, carry-forward eligibility, basic-exemption shortfall, slab computation, section 87A rebate, surcharge, deductions, or treaty relief. Health and education cess is 4% of estimated base tax.",
      "No corporate-action cost adjustments, pre-2018 grandfathered basis, indexation, or foreign/non-qualifying assets are modelled; input prices must already reflect any required basis adjustments. This section-112A estimate is for FY2018-19 onwards, not earlier tax regimes.",
      "Calculations retain numeric precision without statutory rupee rounding; presentation may round currency. Complete valid finite fills and chronological same-date input are required.",
    ],
  };
}
