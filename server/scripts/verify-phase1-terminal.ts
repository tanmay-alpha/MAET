import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const FORBIDDEN_PATTERNS = [
  { pattern: /"L2 Live"/g, reason: "False L2 live label in production UI" },
  { pattern: /"Options Greeks \(Live\)"/g, reason: "False Options Greeks live label in production UI" },
  { pattern: /Math\.random\(\).*bids/g, reason: "Synthetic Level 2 orderbook generation" },
  { pattern: /Math\.random\(\).*delta/g, reason: "Synthetic Options Greeks generation" },
  { pattern: /generateMockLevel2/g, reason: "Mock Level 2 depth generator" },
  { pattern: /generateMockGreeks/g, reason: "Mock Options Greeks generator" },
];

const EXCLUDED_DIRS = ["node_modules", ".output", ".tanstack", ".vercel", "dist", "tests"];

function scanDirectory(dir: string, failures: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(entry)) {
        scanDirectory(fullPath, failures);
      }
    } else if (stat.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
      if (fullPath.includes("verify-phase1-terminal") || fullPath.includes("test")) {
        continue;
      }

      const content = readFileSync(fullPath, "utf8");
      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          failures.push(`Violation in ${fullPath}: ${reason}`);
        }
      }
    }
  }
}

function runVerification(): void {
  console.log("🔍 Running Phase 1 Terminal Static Safety Verification...");
  const failures: string[] = [];

  scanDirectory(join(process.cwd(), "src"), failures);
  scanDirectory(join(process.cwd(), "server"), failures);

  if (failures.length > 0) {
    console.error("❌ Phase 1 Verification FAILED with violations:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log("✅ Phase 1 Terminal Static Safety Verification PASSED cleanly! 0 illegal fake/synthetic claims found.");
}

runVerification();
