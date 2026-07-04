export const DATABASE_PREPARE_DISABLED = true;

export type DatabaseDiagnostics = {
  dbUrlSet: boolean;
  dbHost?: string;
  dbPort?: string;
  dbUserPrefix?: string;
  sslmodeRequire: boolean;
  prepareDisabled: true;
  dbErrorCode?: string;
  dbErrorMessage?: string;
};

export function inspectDatabaseUrl(connectionString?: string): DatabaseDiagnostics {
  const base: DatabaseDiagnostics = {
    dbUrlSet: Boolean(connectionString),
    sslmodeRequire: false,
    prepareDisabled: DATABASE_PREPARE_DISABLED,
  };
  if (!connectionString) return base;

  try {
    const parsed = new URL(connectionString);
    const username = decodeURIComponent(parsed.username);
    return {
      ...base,
      dbHost: parsed.hostname || undefined,
      dbPort: parsed.port || (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:" ? "5432" : undefined),
      dbUserPrefix: username ? username.split(".")[0].slice(0, 16) : undefined,
      sslmodeRequire: parsed.searchParams.get("sslmode") === "require",
    };
  } catch {
    return { ...base, dbErrorCode: "INVALID_URL", dbErrorMessage: "database URL is invalid" };
  }
}

export function redactDatabaseError(error: unknown): { code: string; message: string } {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current !== "object") continue;

    const value = current as { code?: unknown; cause?: unknown; errors?: unknown[]; message?: unknown };
    const code = typeof value.code === "string" ? value.code : undefined;
    if (code === "28P01") return { code, message: "database authentication failed" };
    if (code === "3D000") return { code, message: "database name was not found" };
    if (code === "ENOTFOUND") return { code, message: "database host was not found" };
    if (code === "ECONNREFUSED") return { code, message: "database connection was refused" };
    if (code === "ETIMEDOUT") return { code, message: "database connection timed out" };
    if (value.message === "timeout") return { code: "TIMEOUT", message: "database connection timed out" };
    if (value.cause) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return { code: "DB_QUERY_FAILED", message: "database query failed; verify the pooler URI and credentials" };
}
