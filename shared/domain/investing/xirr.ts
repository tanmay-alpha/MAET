export interface XirrCashFlow {
  /** Negative for money invested; positive for proceeds or terminal valuation. */
  amount: number;
  /** Server-supplied IST calendar date, exactly YYYY-MM-DD. */
  date: string;
}

const MILLISECONDS_PER_DAY = 86_400_000;
const MIN_LOG_RATE = Math.log(Number.EPSILON / 2);
const MAX_LOG_RATE = Math.log(Number.MAX_VALUE);
const RESIDUAL_TOLERANCE = 1e-12;

/**
 * Annual portfolio money-weighted return as a decimal, using ACT/365.
 * Pass investment outflows, distributions and the terminal portfolio value.
 * Two dated flows also calculate an individual investment's annualized return.
 * Input order is irrelevant; input is never mutated. Undefined, invalid and
 * non-convergent cases return JSON-safe null, never NaN or Infinity.
 *
 * Solves sum(amount / (1 + rate) ** (elapsedDays / 365)) = 0, with rate > -1.
 * Dates are civil days, not timestamps: UTC parsing merely supplies a consistent
 * day ordinal and does not convert the supplied IST date to another time zone.
 * Spreadsheet ACT/365 counts leap days but keeps a fixed denominator of 365.
 * https://support.microsoft.com/en-us/excel/functions/xirr-function
 *
 * Dependency review: financial 0.2.4 exposes periodic IRR, not XIRR; xirr 1.1.0
 * was last released in 2020. The maintained MIT-licensed formulajs 4.6.1 XIRR
 * uses an unbounded Newton loop without a bracketed fallback. This bounded
 * implementation instead combines Newton with bisection, avoiding that failure
 * mode without importing an unrelated collection of spreadsheet functions.
 * https://unpkg.com/@formulajs/formulajs@4.6.1/lib/esm/index.mjs
 *
 * Newton starts at the spreadsheet default 10%. Non-conventional flows can
 * have multiple roots: the converged Newton root wins; otherwise the first
 * sign-changing bracket found by symmetric logarithmic expansion wins. No
 * claim of a unique investment return is made for such cash-flow sequences.
 */
export function xirr(cashFlows: readonly XirrCashFlow[]): number | null {
  if (cashFlows.length < 2) return null;

  let scale = 0;
  for (const flow of cashFlows) {
    if (!Number.isFinite(flow.amount)) return null;
    scale = Math.max(scale, Math.abs(flow.amount));
  }
  if (scale === 0) return null;

  const amountsByDay = new Map<number, number>();
  for (const flow of cashFlows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flow.date)) return null;
    const timestamp = Date.parse(`${flow.date}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== flow.date) return null;
    const day = timestamp / MILLISECONDS_PER_DAY;
    amountsByDay.set(day, (amountsByDay.get(day) ?? 0) + flow.amount / scale);
  }

  // Net same-day trades before solving. Otherwise a completely cancelled
  // opening position can create a misleading NPV asymptote at infinite rates.
  const flows = [...amountsByDay]
    .filter(([, amount]) => amount !== 0)
    .sort(([left], [right]) => left - right)
    .map(([day, amount]) => ({ years: day, amount }));
  if (flows.length < 2) return null;

  let positive = false;
  let negative = false;
  let total = 0;
  const firstDay = flows[0]!.years;
  for (const flow of flows) {
    flow.years = (flow.years - firstDay) / 365;
    positive ||= flow.amount > 0;
    negative ||= flow.amount < 0;
    total += flow.amount;
  }
  if (!positive || !negative) return null;
  if (total === 0) return 0;

  const lastYear = flows[flows.length - 1]!.years;
  let value = 0;
  let derivative = 0;
  let magnitude = 0;

  // x = log(1 + rate) keeps Newton away from the invalid rate <= -1 domain.
  // Removing a common positive exponential factor preserves roots and signs,
  // prevents overflow, and makes residual / magnitude scale-independent.
  // The derivative below is the original NPV derivative with that same factor
  // removed, so value / derivative remains the correct Newton step in x.
  function evaluate(logRate: number): void {
    value = 0;
    derivative = 0;
    magnitude = 0;
    const origin = logRate < 0 ? lastYear : 0;
    for (const flow of flows) {
      const term = flow.amount * Math.exp(-(flow.years - origin) * logRate);
      value += term;
      derivative -= flow.years * term;
      magnitude += Math.abs(term);
    }
  }

  const initial = Math.log1p(0.1);
  let current = initial;
  for (let iteration = 0; iteration < 100; iteration++) {
    evaluate(current);
    if (magnitude > 0 && Math.abs(value) <= RESIDUAL_TOLERANCE * magnitude) {
      const rate = Math.expm1(current);
      return Number.isFinite(rate) && rate > -1 ? rate : null;
    }
    if (Math.abs(derivative) <= Number.EPSILON * magnitude) break;
    const next = current - value / derivative;
    if (!Number.isFinite(next) || next < MIN_LOG_RATE || next > MAX_LOG_RATE || next === current) break;
    current = next;
  }

  // Expand on both sides of the default guess. Unlike Newton, bisection cannot
  // escape a sign-changing bracket. Endpoints span finite representable rates;
  // a small absolute NPV alone is never accepted as convergence at an asymptote.
  evaluate(initial);
  let left = initial;
  let right = initial;
  let leftValue = value;
  let rightValue = value;
  let lower = 0;
  let upper = 0;
  let lowerValue = 0;
  let bracketed = false;
  for (let distance = 0.125; left > MIN_LOG_RATE || right < MAX_LOG_RATE; distance *= 2) {
    const nextLeft = Math.max(MIN_LOG_RATE, initial - distance);
    if (nextLeft < left) {
      evaluate(nextLeft);
      if (value === 0 || Math.sign(value) !== Math.sign(leftValue)) {
        lower = nextLeft;
        upper = left;
        lowerValue = value;
        bracketed = true;
        break;
      }
      left = nextLeft;
      leftValue = value;
    }
    const nextRight = Math.min(MAX_LOG_RATE, initial + distance);
    if (nextRight > right) {
      evaluate(nextRight);
      if (value === 0 || Math.sign(value) !== Math.sign(rightValue)) {
        lower = right;
        upper = nextRight;
        lowerValue = rightValue;
        bracketed = true;
        break;
      }
      right = nextRight;
      rightValue = value;
    }
  }
  if (!bracketed) return null;

  for (let iteration = 0; iteration < 200; iteration++) {
    const midpoint = lower + (upper - lower) / 2;
    evaluate(midpoint);
    if (magnitude > 0 && Math.abs(value) <= RESIDUAL_TOLERANCE * magnitude) {
      const rate = Math.expm1(midpoint);
      return Number.isFinite(rate) && rate > -1 ? rate : null;
    }
    if (midpoint === lower || midpoint === upper) break;
    if (Math.sign(value) === Math.sign(lowerValue)) {
      lower = midpoint;
      lowerValue = value;
    } else {
      upper = midpoint;
    }
  }
  return null;
}
