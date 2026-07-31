import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const PLACEHOLDER_PATTERNS = [
  /Placeholder:/i,
  /returns empty until/i,
  /marketCap:\s*1000000000/i,
  /price:\s*100\b/i,
  /source:\s*["']synthetic["']/i,
  /Math\.sinGenerated/i,
  /presetId:\s*crypto\.randomUUID\(\)(?!\s*[^]*insert)/i,
  /status:\s*["']queued_retry["'](?!\s*[^]*runDaily)/i,
  /\(ctx as any\)\.isAdmin/i,
  /\(ctx as any\)\.userRole/i,
  /assertAdmin\(\s*ctx as any\s*\)/i,
  /empty success mutation/i,
];

const TARGET_DIRECTORIES = [
  join(process.cwd(), "server", "api", "trpc", "routers"),
  join(process.cwd(), "server", "modules"),
  join(process.cwd(), "server", "workers"),
];

let failed = false;

function scanDirectory(dir: string) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanDirectory(fullPath);
      } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
        if (fullPath.endsWith(".test.ts") || fullPath.endsWith(".spec.ts") || fullPath.includes("/fixtures/")) {
          continue;
        }
        const content = readFileSync(fullPath, "utf-8");
        for (const pattern of PLACEHOLDER_PATTERNS) {
          if (pattern.test(content)) {
            console.error(`[PLACEHOLDER ERROR] Production file ${fullPath} matches placeholder pattern ${pattern}`);
            failed = true;
          }
        }
      }
    }
  } catch (e) {
    // Directory might not exist in some builds
  }
}

console.log("Running advanced feature placeholder verification...");
for (const dir of TARGET_DIRECTORIES) {
  scanDirectory(dir);
}

if (failed) {
  console.error("Placeholder verification FAILED. Found placeholder patterns in production code.");
  process.exit(1);
} else {
  console.log("Placeholder verification PASSED cleanly. 0 placeholders found in production code.");
}
