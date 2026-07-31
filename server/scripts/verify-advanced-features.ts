import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const PLACEHOLDER_PATTERNS = [
  /Placeholder:/i,
  /returns empty until/i,
  /\badvances:\s*0\b(?![^]*calculateMarketBreadth)/,
  /\bcells:\s*\[\]\b(?![^]*getHeatmapCells)/,
  /\bstatus:\s*"queued"\b(?![^]*jobQueue)/,
  /\brun:\s*null\b/i,
  /\bruns:\s*\[\]\b/i,
];

const TARGET_DIRECTORIES = [
  join(process.cwd(), "server", "api", "trpc", "routers"),
  join(process.cwd(), "server", "modules"),
];

let failed = false;

function scanDirectory(dir: string) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDirectory(fullPath);
    } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      // Ignore test files or explicit fixture files annotated with 'fixture'
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
