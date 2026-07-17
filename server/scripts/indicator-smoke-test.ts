// server/scripts/indicator-smoke-test.ts
// Smoke test to calculate and verify all 100+ technical indicators on mock data

import { calculateAllIndicators } from "../domain/technical/indicators-extended";
import type { Candle } from "@shared/types";

function generateMockCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let basePrice = 100;
  let volume = 10000;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 4;
    const open = basePrice;
    const close = basePrice + change;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    
    basePrice = close;
    volume += Math.floor((Math.random() - 0.5) * 2000);

    candles.push({
      symbol: "TEST",
      timeframe: "1d",
      ts: new Date(now - (count - i) * 24 * 60 * 60 * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.max(volume, 100),
      source: "mock",
    });
  }
  return candles;
}

function main() {
  console.log("Generating 300 mock candles for testing...");
  const candles = generateMockCandles(300);

  console.log("Calculating indicators...");
  const result = calculateAllIndicators(candles);

  console.log("Calculated Indicators Summary:");
  const keys = Object.keys(result);
  console.log(`- Total calculated keys: ${keys.length}`);

  let failedCount = 0;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "number" && isNaN(value)) {
      console.error(`❌ Indicator '${key}' is NaN!`);
      failedCount++;
    } else if (value && typeof value === "object") {
      // Check pivot properties
      for (const [pKey, pVal] of Object.entries(value)) {
        if (typeof pVal === "number" && isNaN(pVal)) {
          console.error(`❌ Pivot Indicator '${key}.${pKey}' is NaN!`);
          failedCount++;
        }
      }
    }
  }

  if (failedCount > 0) {
    console.error(`❌ Failed: Found ${failedCount} NaN values!`);
    process.exit(1);
  }

  function countLeafNodes(obj: any): number {
    if (obj === null || obj === undefined) return 0;
    if (typeof obj !== "object") return 1;
    let count = 0;
    for (const key of Object.keys(obj)) {
      if (key === "calculatedAt") continue;
      count += countLeafNodes(obj[key]);
    }
    return count;
  }

  console.log("✅ All indicators computed successfully with NO NaN values!");
  console.log(`- Total unique indicator variables calculated: ${countLeafNodes(result)}`);
  console.log(`- Sample SMA200: ${result.sma["200"]}`);
  console.log(`- Sample RSI14: ${result.rsi["14"]}`);
  console.log(`- Sample MACD Histogram: ${result.macd.macdHist}`);
  console.log(`- Sample Bollinger Upper: ${result.bollinger.bbUpper}`);
  console.log(`- Sample OBV: ${result.obv}`);
  console.log(`- Sample Linear Regression Slope: ${result.linRegSlope}`);
}

main();
