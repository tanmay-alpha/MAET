/**
 * Evaluation script — tests the natural-language screener pipeline.
 *
 * Run: npx tsx server/modules/screener-dsl/evaluate.ts
 */

import { tokenize, TokenizeError } from "./tokenizer";
import { ScreenerDslParser } from "./parser";
import { ScreenerCompiler } from "./compiler";

interface TestCase {
  input: string;
  expectedSuccess: boolean;
  expectedField?: string;
}

const cases: TestCase[] = [
  { input: "ROE above 15", expectedSuccess: true, expectedField: "roe" },
  { input: "PE below 25", expectedSuccess: true, expectedField: "pe" },
  { input: "Revenue growth above 10", expectedSuccess: true, expectedField: "revenue_growth" },
  { input: "Debt to equity below 0.5", expectedSuccess: true, expectedField: "debt_to_equity" },
  { input: "RSI below 35", expectedSuccess: true, expectedField: "rsi" },
  { input: "Large cap banks with dividend yield above 2", expectedSuccess: true },
  { input: "ROE above 15 and PE below 25", expectedSuccess: true, expectedField: "roe" },
  { input: "ROE above 15 or PE below 25", expectedSuccess: true },
  { input: "Price within 5 percent of 52 week high", expectedSuccess: true },
];

let passed = 0;
let failed = 0;

for (const test of cases) {
  try {
    const result = new ScreenerDslParser().parse(test.input);

    if (test.expectedSuccess && result.success && result.ast) {
      if (test.expectedField && result.ast.kind === "literal") {
        if (result.ast.field === test.expectedField) {
          passed++;
          continue;
        }
        console.log(`FAIL: "${test.input}" — expected field ${test.expectedField}, got ${result.ast.field}`);
        failed++;
        continue;
      }
      passed++;
    } else if (!test.expectedSuccess && !result.success) {
      passed++;
    } else {
      console.log(`FAIL: "${test.input}" — expected success=${test.expectedSuccess}, got ${result.success}`);
      failed++;
    }
  } catch (err) {
    console.log(`ERROR: "${test.input}" — ${err}`);
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}