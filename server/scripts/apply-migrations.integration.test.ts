import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getSqlClient } from "../data/drizzle/client";
import { applyMigrations, findNonTransactionalStatements } from "./apply-migrations";

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
const schema = `t_migrate_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const trackingTable = `${schema}._applied_migrations`;
const tempDirs: string[] = [];

function migrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "maet-migrations-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

async function trackedNames(): Promise<string[]> {
  const rows = await getSqlClient()<{ name: string }[]>`SELECT name FROM ${getSqlClient()(trackingTable)} ORDER BY name`;
  return rows.map((row) => row.name);
}

async function relationExists(name: string): Promise<boolean> {
  const [row] = await getSqlClient()`SELECT to_regclass(${`${schema}.${name}`}) AS relation`;
  return row?.relation !== null;
}

describe("findNonTransactionalStatements", () => {
  it("flags statements PostgreSQL rejects inside a transaction", () => {
    expect(findNonTransactionalStatements("CREATE INDEX CONCURRENTLY idx ON t (c);")).toEqual(["CONCURRENTLY"]);
    expect(findNonTransactionalStatements("BEGIN;\nCREATE TABLE t (id int);\nCOMMIT;")).toEqual([
      "explicit transaction control",
    ]);
    expect(findNonTransactionalStatements("VACUUM ANALYZE t;")).toEqual(["VACUUM"]);
  });

  it("ignores comments and plpgsql bodies", () => {
    const sql = `-- never use CREATE INDEX CONCURRENTLY here
      DO $$
      BEGIN
        PERFORM 1;
      END;
      $$;`;
    expect(findNonTransactionalStatements(sql)).toEqual([]);
  });

  it("accepts every committed migration", () => {
    const dir = join(import.meta.dir, "../db/migrations");
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => findNonTransactionalStatements(readFileSync(join(dir, name), "utf8")).length > 0);
    expect(offenders).toEqual([]);
  });
});

describe("applyMigrations transactions", () => {
  beforeAll(async () => {
    if (hasDatabase) await getSqlClient().unsafe(`CREATE SCHEMA ${schema}`);
  });

  afterAll(async () => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    if (!hasDatabase) return;
    await getSqlClient().unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await closeDb();
  });

  it("rolls back a failing migration's DDL together with its tracking row", async () => {
    if (!hasDatabase) {
      console.warn("TEST_DATABASE_URL not set; skipping migration runner PostgreSQL test");
      return;
    }
    const dir = migrationDir({
      "0001_ok.sql": `CREATE TABLE ${schema}.ok_table (id int);`,
      "0002_fails_midway.sql": `CREATE TABLE ${schema}.partial_table (id int);\nSELECT 1 / 0;`,
      "0003_never_reached.sql": `CREATE TABLE ${schema}.later_table (id int);`,
    });

    await expect(applyMigrations({ migrationsDir: dir, trackingTable })).rejects.toThrow(/division by zero/u);

    expect(await trackedNames()).toEqual(["0001_ok.sql"]);
    expect(await relationExists("ok_table")).toBe(true);
    expect(await relationExists("partial_table")).toBe(false);
    expect(await relationExists("later_table")).toBe(false);
  });

  it("does not keep a migration's DDL when recording it fails", async () => {
    if (!hasDatabase) return;
    // The migration succeeds but makes its own tracking INSERT fail, simulating
    // a crash or error between applying DDL and recording it.
    const dir = migrationDir({
      "0001_ok.sql": `CREATE TABLE ${schema}.ok_table (id int);`,
      "0003_unrecordable.sql": `
        CREATE TABLE ${schema}.unrecorded_table (id int);
        ALTER TABLE ${trackingTable} ADD CONSTRAINT reject_0003 CHECK (name <> '0003_unrecordable.sql');
      `,
    });

    await expect(applyMigrations({ migrationsDir: dir, trackingTable })).rejects.toThrow(/reject_0003/u);

    expect(await trackedNames()).toEqual(["0001_ok.sql"]);
    expect(await relationExists("unrecorded_table")).toBe(false);
  });

  it("refuses to start when a pending migration cannot run in a transaction", async () => {
    if (!hasDatabase) return;
    const dir = migrationDir({
      "0001_ok.sql": `CREATE TABLE ${schema}.ok_table (id int);`,
      "0002_fixed.sql": `CREATE TABLE ${schema}.fixed_table (id int);`,
      "0003_concurrent.sql": `CREATE INDEX CONCURRENTLY fixed_idx ON ${schema}.fixed_table (id);`,
    });

    await expect(applyMigrations({ migrationsDir: dir, trackingTable })).rejects.toThrow(
      /0003_concurrent\.sql \(CONCURRENTLY\)/u,
    );
    expect(await trackedNames()).toEqual(["0001_ok.sql"]);
    expect(await relationExists("fixed_table")).toBe(false);
  });
});
