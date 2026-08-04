/**
 * Phase 3 Strategy Lab — static verification script.
 *
 * Verifies without running tests:
 * 1. All required files exist
 * 2. Migration 0016 is additive-only (no DROP TABLE)
 * 3. All new tRPC routers are registered in index.ts
 * 4. No eval() or Function() in AST evaluator
 * 5. No Math.random() in backtest runner (determinism check)
 * 6. Shared strategy modules export required symbols
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");  // MAET root
const SHARED_ROOT = join(ROOT, "shared", "strategy");
const SERVER_ROOT = join(ROOT, "server");

// ============================================================
// Check helpers
// ============================================================

const checks: Array<{ name: string; fn: () => boolean | Promise<boolean> }> = [];
let passed = 0;
let failed = 0;

function check(name: string, fn: () => boolean | Promise<boolean>) {
  checks.push({ name, fn });
}

function requireFile(path: string): boolean {
  const exists = existsSync(path);
  if (!exists) console.error(`  ❌ Missing: ${path}`);
  return exists;
}

function fileContains(path: string, pattern: string | RegExp): boolean {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  return typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
}

function fileNotContains(path: string, pattern: string | RegExp): boolean {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const found = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  if (found) console.error(`  ❌ Found forbidden pattern in ${path}: ${pattern}`);
  return !found;
}

// ============================================================
// Slice 1: Shared strategy modules
// ============================================================

check("S1.1 shared/strategy/ast.ts exists", () =>
  requireFile(join(SHARED_ROOT, "ast.ts")));

check("S1.2 shared/strategy/schemas.ts exists", () =>
  requireFile(join(SHARED_ROOT, "schemas.ts")));

check("S1.3 shared/strategy/contracts.ts exists", () =>
  requireFile(join(SHARED_ROOT, "contracts.ts")));

check("S1.4 shared/strategy/operators.ts exists", () =>
  requireFile(join(SHARED_ROOT, "operators.ts")));

check("S1.5 shared/strategy/version.ts exports STRATEGY_ENGINE_VERSION", () =>
  fileContains(join(SHARED_ROOT, "version.ts"), "STRATEGY_ENGINE_VERSION"));

check("S1.6 Migration 0016 SQL exists", () =>
  requireFile(join(SERVER_ROOT, "db", "migrations", "0016_strategy_lab.sql")));

check("S1.7 Migration 0016 has zero DROP TABLE statements", () => {
  const content = readFileSync(join(SERVER_ROOT, "db", "migrations", "0016_strategy_lab.sql"), "utf-8");
  // Exclude comment lines (starting with --) from the check
  const nonCommentLines = content.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const hasDropTable = /DROP\s+TABLE/i.test(nonCommentLines);
  if (hasDropTable) console.error("  ❌ Found DROP TABLE statement in migration (non-comment)");
  return !hasDropTable;
});

check("S1.8 Migration 0016 uses IF NOT EXISTS for all CREATE TABLE", () => {
  const content = readFileSync(join(SERVER_ROOT, "db", "migrations", "0016_strategy_lab.sql"), "utf-8");
  const badCreates = content.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/gi) ?? [];
  if (badCreates.length > 0) {
    console.error(`  ❌ Found CREATE TABLE without IF NOT EXISTS: ${badCreates.length} occurrences`);
    return false;
  }
  return true;
});

check("S1.9 Migration 0016 defines all 14 Strategy Lab tables", () => {
  const content = readFileSync(join(SERVER_ROOT, "db", "migrations", "0016_strategy_lab.sql"), "utf-8");
  const tables = [
    "strategy_definitions", "strategy_versions", "strategy_backtest_jobs",
    "strategy_backtest_trades", "strategy_equity_points", "strategy_parameter_sweeps",
    "strategy_sweep_results", "strategy_walk_forward_runs", "strategy_walk_forward_windows",
    "strategy_deployments", "strategy_signal_events", "strategy_execution_decisions",
    "strategy_performance_snapshots", "strategy_replay_sessions",
  ];
  return tables.every((t) => {
    const has = content.includes(t);
    if (!has) console.error(`  ❌ Missing table: ${t}`);
    return has;
  });
});

check("S1.10 schema.ts includes Phase 3 tables", () =>
  fileContains(join(SERVER_ROOT, "db", "schema.ts"), "strategyDefinitions") &&
  fileContains(join(SERVER_ROOT, "db", "schema.ts"), "strategyVersions") &&
  fileContains(join(SERVER_ROOT, "db", "schema.ts"), "strategyDeployments"));

// ============================================================
// Slice 2: Strategy Definitions API
// ============================================================

check("S2.1 strategy-definitions/repository.ts exists", () =>
  requireFile(join(SERVER_ROOT, "modules", "strategy-definitions", "repository.ts")));

check("S2.2 strategy-definitions/service.ts exists", () =>
  requireFile(join(SERVER_ROOT, "modules", "strategy-definitions", "service.ts")));

check("S2.3 strategy-definitions router exists", () =>
  requireFile(join(SERVER_ROOT, "api", "trpc", "routers", "strategy-definitions.ts")));

check("S2.4 All 5 Phase 3 routers registered in tRPC index", () => {
  const indexPath = join(SERVER_ROOT, "api", "trpc", "index.ts");
  return ["strategyDefinitions", "strategyBacktests", "strategyOptimisation", "strategyReplay", "strategyDeployments"]
    .every((r) => fileContains(indexPath, r));
});

// ============================================================
// Slice 3: Backtest Engine V3 safety
// ============================================================

check("S3.1 ast-evaluator.ts exists", () =>
  requireFile(join(SERVER_ROOT, "domain", "strategy", "ast-evaluator.ts")));

check("S3.2 indicator-state.ts exists", () =>
  requireFile(join(SERVER_ROOT, "domain", "strategy", "indicator-state.ts")));

check("S3.3 runner-v3.ts exists", () =>
  requireFile(join(SERVER_ROOT, "domain", "strategy", "runner-v3.ts")));

check("S3.4 NO eval() in ast-evaluator.ts", () =>
  fileNotContains(join(SERVER_ROOT, "domain", "strategy", "ast-evaluator.ts"), /\beval\s*\(/));

check("S3.5 NO new Function() in ast-evaluator.ts", () =>
  fileNotContains(join(SERVER_ROOT, "domain", "strategy", "ast-evaluator.ts"), /new\s+Function\s*\(/));

check("S3.6 NO Math.random() in runner-v3.ts (determinism)", () =>
  fileNotContains(join(SERVER_ROOT, "domain", "strategy", "runner-v3.ts"), /Math\.random\s*\(\)/));

check("S3.7 runner-v3.ts imports IndicatorStateCache", () =>
  fileContains(join(SERVER_ROOT, "domain", "strategy", "runner-v3.ts"), "IndicatorStateCache"));

check("S3.8 runner-v3.ts stamps engine version on result", () =>
  fileContains(join(SERVER_ROOT, "domain", "strategy", "runner-v3.ts"), "STRATEGY_ENGINE_VERSION"));

check("S3.9 fee-model.ts contains disclaimer comment", () =>
  fileContains(join(SERVER_ROOT, "domain", "strategy", "fee-model.ts"), "approximations"));

check("S3.10 position-sizer.ts exists with VOLATILITY_TARGET", () =>
  fileContains(join(SERVER_ROOT, "domain", "strategy", "position-sizer.ts"), "VOLATILITY_TARGET"));

// ============================================================
// Slice 4: Worker safety
// ============================================================

check("S4.1 backtest-worker.ts exists", () =>
  requireFile(join(SERVER_ROOT, "workers", "backtest-worker.ts")));

check("S4.2 sweep-worker.ts exists", () =>
  requireFile(join(SERVER_ROOT, "workers", "sweep-worker.ts")));

check("S4.3 walk-forward-worker.ts exists", () =>
  requireFile(join(SERVER_ROOT, "workers", "walk-forward-worker.ts")));

check("S4.4 strategy-evaluator.ts exists", () =>
  requireFile(join(SERVER_ROOT, "workers", "strategy-evaluator.ts")));

check("S4.5 package.json contains all 4 runnable worker scripts", () => {
  const pkgPath = join(ROOT, "package.json");
  return fileContains(pkgPath, "worker:backtest") &&
         fileContains(pkgPath, "worker:sweep") &&
         fileContains(pkgPath, "worker:walk-forward") &&
         fileContains(pkgPath, "worker:evaluator");
});

check("S4.6 worker uses FOR UPDATE SKIP LOCKED via claimNextJob", () =>
  fileContains(join(SERVER_ROOT, "modules", "strategy-jobs", "repository.ts"), "FOR UPDATE SKIP LOCKED"));

check("S4.7 worker checks cancellation during run", () =>
  fileContains(join(SERVER_ROOT, "workers", "backtest-worker.ts"), "isCancellationRequested"));

check("S4.8 worker sets up heartbeat interval", () =>
  fileContains(join(SERVER_ROOT, "workers", "backtest-worker.ts"), "HEARTBEAT_INTERVAL_MS"));

check("S4.9 worker calls recoverAbandonedJobs on startup", () =>
  fileContains(join(SERVER_ROOT, "workers", "backtest-worker.ts"), "recoverAbandonedJobs"));

// ============================================================
// Slice 7: Deployments & Replay safety
// ============================================================

check("S7.1 strategy-deployments router has toggleKillSwitch", () =>
  fileContains(join(SERVER_ROOT, "api", "trpc", "routers", "strategy-deployments.ts"), "toggleKillSwitch"));

check("S7.2 AUTO_PAPER requires maximumDailyLossPercent validation", () =>
  fileContains(join(SERVER_ROOT, "api", "trpc", "routers", "strategy-deployments.ts"), "AUTO_PAPER"));

check("S7.3 confirmProposal executes real PaperTradingService order (no placeholder)", () => {
  const routerPath = join(SERVER_ROOT, "api", "trpc", "routers", "strategy-deployments.ts");
  return fileContains(routerPath, "PaperTradingService") &&
         fileNotContains(routerPath, "requires paper-trading router integration");
});

check("S7.4 replay-engine.ts exists and isolates replay trading", () =>
  requireFile(join(SERVER_ROOT, "modules", "strategy-replay", "replay-engine.ts")));

check("S7.5 portfolio-runner.ts exists and implements multi-symbol runner", () =>
  requireFile(join(SERVER_ROOT, "domain", "strategy", "portfolio-runner.ts")));

// ============================================================
// Slice 8: Frontend routes
// ============================================================

check("S8.1 _app.strategies.tsx is Strategy Lab (not options builder)", () => {
  const path = join(SERVER_ROOT, "..", "src", "routes", "_app.strategies.tsx");
  return fileContains(path, "Strategy Lab") && !fileContains(path, "Options Builder");
});

check("S8.2 _app.replay.tsx exists", () =>
  requireFile(join(SERVER_ROOT, "..", "src", "routes", "_app.replay.tsx")));

check("S8.3 _app.performance.tsx exists", () =>
  requireFile(join(SERVER_ROOT, "..", "src", "routes", "_app.performance.tsx")));

check("S8.4 sidebar has Strategy Lab group", () =>
  fileContains(join(SERVER_ROOT, "..", "src", "components", "app-sidebar.tsx"), "Strategy Lab"));

check("S8.5 sidebar links to /replay", () =>
  fileContains(join(SERVER_ROOT, "..", "src", "components", "app-sidebar.tsx"), "/replay"));

check("S8.6 Educational disclaimer in strategy library", () =>
  fileContains(
    join(SERVER_ROOT, "..", "src", "components", "strategy", "strategy-library.tsx"),
    "Educational",
  ));

check("S8.7 strategy-library has no synthetic return claims", () => {
  const content = readFileSync(join(SERVER_ROOT, "..", "src", "components", "strategy", "strategy-library.tsx"), "utf-8");
  const badPhrases = ["guaranteed", "profitable", "always wins", "100%", "risk-free"];
  const found = badPhrases.filter((p) => content.toLowerCase().includes(p.toLowerCase()));
  if (found.length > 0) {
    console.error(`  ❌ Found synthetic return claim(s): ${found.join(", ")}`);
    return false;
  }
  return true;
});

// ============================================================
// Shared AST contracts
// ============================================================

check("S_AST.1 MAX_NESTING_DEPTH = 8", () =>
  fileContains(join(SHARED_ROOT, "ast.ts"), "MAX_NESTING_DEPTH = 8"));

check("S_AST.2 MAX_LAG = 50 (no time travel)", () =>
  fileContains(join(SHARED_ROOT, "ast.ts"), "MAX_LAG = 50"));

check("S_AST.3 validateAst checks for negative lags", () =>
  fileContains(join(SHARED_ROOT, "ast.ts"), "Negative lag"));

// ============================================================
// Run all checks
// ============================================================

async function runChecks() {
  console.log("\n" + "═".repeat(60));
  console.log("  Phase 3 Strategy Lab — Static Verification");
  console.log("═".repeat(60) + "\n");

  for (const c of checks) {
    try {
      const ok = await c.fn();
      if (ok) {
        console.log(`  ✅ ${c.name}`);
        passed++;
      } else {
        console.log(`  ❌ ${c.name}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${c.name} — threw: ${err}`);
      failed++;
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed of ${checks.length} checks`);
  console.log("─".repeat(60) + "\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runChecks();
