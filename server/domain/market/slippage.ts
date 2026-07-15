export type LiquidityTier = "HIGH" | "MEDIUM" | "LOW";

export interface LiquidityParameters {
  halfSpread: number;      // absolute INR half-spread
  gamma: number;           // empirical market-impact coefficient
  avg10MinVolume: number;  // average 10-minute volume in shares
}

// Calibrated using BigQuery historical tick datasets over the last 30 days
export const LIQUIDITY_TIER_PARAMS: Record<LiquidityTier, LiquidityParameters> = {
  HIGH: {
    halfSpread: 0.1200,     // VWAS = 0.2401, Half-Spread = 0.1200 INR
    gamma: 0.5,             // Coefficient for highly liquid assets
    avg10MinVolume: 105566.0, // Calibrated minute volume (10556.6) * 10 minutes
  },
  MEDIUM: {
    halfSpread: 0.0538,     // VWAS = 0.1075, Half-Spread = 0.0538 INR
    gamma: 0.8,             // Coefficient for medium liquid assets
    avg10MinVolume: 35545.6,  // Calibrated minute volume (3554.56) * 10 minutes
  },
  LOW: {
    halfSpread: 0.0114,     // VWAS = 0.0228, Half-Spread = 0.0114 INR
    gamma: 1.5,             // Coefficient for low liquid assets
    avg10MinVolume: 5472.9,   // Calibrated minute volume (547.29) * 10 minutes
  },
};

const NON_LINEAR_EXPONENT = 0.6; // alpha

/**
 * Classifies a ticker symbol into a liquidity tier based on trading volume and/or market capitalization bucket.
 * 
 * @param avgDailyVolume The historical daily trading volume (optional).
 * @param marketCapBucket The market capitalization bucket ('large', 'mid', 'small', 'micro') (optional).
 * @returns The classified LiquidityTier.
 */
export function getLiquidityTier(
  avgDailyVolume?: number,
  marketCapBucket?: string
): LiquidityTier {
  if (avgDailyVolume !== undefined && avgDailyVolume > 0) {
    if (avgDailyVolume >= 2000000) {
      return "HIGH";
    } else if (avgDailyVolume >= 300000) {
      return "MEDIUM";
    } else {
      return "LOW";
    }
  }

  if (marketCapBucket) {
    const bucket = marketCapBucket.toLowerCase();
    if (bucket === "large") {
      return "HIGH";
    } else if (bucket === "mid") {
      return "MEDIUM";
    } else if (bucket === "small" || bucket === "micro") {
      return "LOW";
    }
  }

  // Default to MEDIUM if no volume or cap info is provided.
  return "MEDIUM";
}

/**
 * Calculates absolute slippage (in INR) using the modified Almgren-Chriss framework.
 * 
 * η = Half-Spread + γ * (Order Volume / Average 10-Minute Volume)^α * σ_daily
 * 
 * @param ltp Last Traded Price of the asset
 * @param orderQty Quantity of shares being ordered
 * @param avgDailyVolume Historical average daily trading volume of the asset (optional)
 * @param marketCapBucket Market capitalization bucket (optional)
 * @param dailyVolatilityPct Daily price volatility as a percentage (default 2% or 0.02)
 * @returns The absolute slippage in INR.
 */
export function calculateSlippage(
  ltp: number,
  orderQty: number,
  avgDailyVolume?: number,
  marketCapBucket?: string,
  dailyVolatilityPct = 0.02
): number {
  const tier = getLiquidityTier(avgDailyVolume, marketCapBucket);
  const params = LIQUIDITY_TIER_PARAMS[tier];

  // Calculate daily asset volatility in absolute price (INR)
  // σ_daily = LTP * volatility_percentage
  const sigmaDaily = ltp * dailyVolatilityPct;

  // Calculate order ratio: Order Volume / Average 10-Minute Volume
  const orderVolumeRatio = orderQty / params.avg10MinVolume;

  // Almgren-Chriss formula:
  // η = Half-Spread + γ * (Order Volume Ratio)^α * σ_daily
  const impactTerm = params.gamma * Math.pow(orderVolumeRatio, NON_LINEAR_EXPONENT) * sigmaDaily;
  const slippage = params.halfSpread + impactTerm;

  // Slippage cannot be negative, and should be at least the half-spread
  return Math.max(params.halfSpread, slippage);
}
