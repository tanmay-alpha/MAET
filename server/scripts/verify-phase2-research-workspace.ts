import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const FORBIDDEN_PHASE2_PATTERNS = [
  { pattern: /drawingsOnlyPixels/g, reason: "Drawings persisted only as screen pixels without financial time/price coordinates" },
  { pattern: /fakeCloudSaveSuccess/g, reason: "Fake successful cloud save response" },
  { pattern: /placeOrderFromDrawingDirectly/g, reason: "Automatic order placement directly from drawing interaction" },
  { pattern: /Math\.random\(\).*fakePnl/g, reason: "Synthetic journal P&L calculation" },
  { pattern: /serviceRoleKey.*frontend/g, reason: "Service-role credential exposed in frontend" },
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
      if (fullPath.includes("verify-phase2-research-workspace") || fullPath.includes("test")) {
        continue;
      }

      const content = readFileSync(fullPath, "utf8");
      for (const { pattern, reason } of FORBIDDEN_PHASE2_PATTERNS) {
        if (pattern.test(content)) {
          failures.push(`Violation in ${fullPath}: ${reason}`);
        }
      }
    }
  }
}

function runPhase2Verification(): void {
  console.log("🔍 Running Phase 2 Research Workspace Static Safety Verification...");
  const failures: string[] = [];

  scanDirectory(join(process.cwd(), "src"), failures);
  scanDirectory(join(process.cwd(), "server"), failures);

  if (failures.length > 0) {
    console.error("❌ Phase 2 Verification FAILED with violations:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log("✅ Phase 2 Research Workspace Static Safety Verification PASSED cleanly! 0 illegal fake/synthetic claims found.");
}

runPhase2Verification();
