/**
 * Which database `bun run seed:demo` may write to.
 *
 * The target comes only from MIGRATION_DATABASE_URL, or TEST_DATABASE_URL with NODE_ENV=test
 * (the migration CLI's rule; the app's DATABASE_URL / SUPABASE_DB_URL are never used). A target
 * that does not look like a disposable local database is refused unless `--i-know` is passed.
 * "Local" is deliberately narrow: loopback, single-label docker-compose service names and *.local.
 * Every other host, including private-network addresses, counts as possibly production.
 */

import { resolveMigrationDatabaseUrl } from "../../scripts/apply-migrations";

export const OVERRIDE_FLAG = "--i-know";

export class DemoTargetRefusedError extends Error {
  constructor(reason: string) {
    super(`Refusing to seed demo data: ${reason}. Pass ${OVERRIDE_FLAG} only if this database is disposable.`);
    this.name = "DemoTargetRefusedError";
  }
}

const APP_DATABASE_VARIABLES = ["SUPABASE_DB_URL", "DATABASE_URL", "POSTGRES_URL"] as const;
const PRODUCTION_NAME = /prod|live/iu;

function isLocalHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host === "host.docker.internal") return true;
  if (host === "::1" || host === "0.0.0.0" || /^127(?:\.\d{1,3}){3}$/u.test(host)) return true;
  if (host.endsWith(".local")) return true;
  // A docker-compose service name ("postgres", "db"): no dots, not an IP.
  return /^[a-z0-9-]+$/iu.test(host) && !/^\d+$/u.test(host);
}

/** Why `url` may be a production database, or null when it looks like a local scratch database. */
export function productionLookingReason(url: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "the target is not a parseable database URL";
  }
  for (const name of APP_DATABASE_VARIABLES) {
    if (env[name] && env[name] === url) return `the target is the application's ${name}`;
  }
  const host = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!isLocalHost(host)) return `host "${host}" is not a local database host`;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (PRODUCTION_NAME.test(database) || PRODUCTION_NAME.test(host)) {
    return `"${host}/${database}" is named like a production database`;
  }
  return null;
}

/** The database URL to seed; throws DemoTargetRefusedError for a production-looking target. */
export function resolveDemoSeedTarget(env: NodeJS.ProcessEnv, argv: readonly string[]): string {
  const url = resolveMigrationDatabaseUrl(env);
  const reason = productionLookingReason(url, env);
  if (reason && !argv.includes(OVERRIDE_FLAG)) throw new DemoTargetRefusedError(reason);
  return url;
}
