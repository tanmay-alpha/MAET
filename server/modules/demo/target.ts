/**
 * Which database `bun run seed:demo` may write to.
 *
 * The target comes only from MIGRATION_DATABASE_URL, or TEST_DATABASE_URL with NODE_ENV=test
 * (the migration CLI's rule; the app's DATABASE_URL / SUPABASE_DB_URL are never used). A target
 * that does not look like a disposable local database is refused unless `--i-know` is passed.
 * "Local" is deliberately narrow: loopback, `localhost` and *.local. Every other host, including
 * single-label names (a docker-compose service, but also a Render internal host such as
 * `dpg-…-a`) and private-network addresses, counts as possibly production.
 *
 * A local-looking URL can still reach production (an SSH tunnel on 127.0.0.1), so seeding also
 * checks what the database holds before writing: see assertSeedableContents.
 */

import type postgres from "postgres";
import { resolveMigrationDatabaseUrl } from "../../scripts/apply-migrations";
import { DEMO_DATA_SOURCE, DEMO_SYMBOLS, DEMO_USER_ID } from "./universe";

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
  return host.endsWith(".local");
}

/**
 * Why the connected database looks like it serves real users, or null when it holds nothing but
 * a previous demo seed: users other than the demo user (public.users or Supabase's auth.users),
 * or companies that are not seeded DEMO- rows.
 */
export async function nonDemoContentsReason(sql: postgres.Sql): Promise<string | null> {
  const [row] = await sql<{ public_users: number | null; auth_users: number | null; companies: number | null }[]>`
    SELECT
      CASE WHEN to_regclass('public.users') IS NULL THEN NULL
        ELSE (SELECT count(*)::int FROM public.users WHERE id <> ${DEMO_USER_ID}) END AS public_users,
      CASE WHEN to_regclass('auth.users') IS NULL THEN NULL
        ELSE (SELECT count(*)::int FROM auth.users WHERE id <> ${DEMO_USER_ID}) END AS auth_users,
      CASE WHEN to_regclass('public.companies') IS NULL THEN NULL
        ELSE (SELECT count(*)::int FROM public.companies
              WHERE NOT (id IN ${sql(DEMO_SYMBOLS)} AND data_source = ${DEMO_DATA_SOURCE})) END AS companies`;
  const users = Math.max(row.public_users ?? 0, row.auth_users ?? 0);
  if (users > 0) return `the database holds ${users} user(s) other than the demo user`;
  if ((row.companies ?? 0) > 0) return `the database holds ${row.companies} companies that are not demo rows`;
  return null;
}

/** Throws DemoTargetRefusedError when the connected database holds non-demo data, unless overridden. */
export async function assertSeedableContents(sql: postgres.Sql, allowExistingData: boolean): Promise<void> {
  if (allowExistingData) return;
  const reason = await nonDemoContentsReason(sql);
  if (reason) throw new DemoTargetRefusedError(reason);
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
