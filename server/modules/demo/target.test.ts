import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { DemoTargetRefusedError, productionLookingReason, resolveDemoSeedTarget } from "./target";

const repoRoot = join(import.meta.dir, "../../..");

describe("demo seed target guard", () => {
  it("accepts local scratch databases", () => {
    for (const url of [
      "postgresql://postgres:postgres@127.0.0.1:58432/maet_test_demo",
      "postgres://postgres@localhost/maet_demo",
      "postgresql://postgres:postgres@[::1]:5432/maet_demo",
      "postgresql://postgres:postgres@pg.local:5432/maet_demo",
    ]) {
      expect(productionLookingReason(url, {})).toBeNull();
    }
  });

  it("flags hosted, remote and production-named databases", () => {
    for (const url of [
      "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres",
      "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
      "postgresql://u:pw@maet.cluster-1.ap-south-1.rds.amazonaws.com/maet",
      "postgresql://u:pw@10.0.4.12:5432/maet",
      // Single-label hosts: a Render internal Postgres host, and a docker-compose service name.
      "postgresql://maet:pw@dpg-abcdef123456-a/maet",
      "postgresql://postgres:postgres@postgres:5432/maet_demo",
      "postgresql://postgres:postgres@localhost:5432/maet_prod",
      "not a url",
    ]) {
      expect(productionLookingReason(url, {})).not.toBeNull();
    }
    const appUrl = "postgresql://postgres:postgres@127.0.0.1:5432/maet";
    expect(productionLookingReason(appUrl, { DATABASE_URL: appUrl })).toContain("DATABASE_URL");
  });

  it("refuses a production-looking target unless --i-know is passed", () => {
    const env = { MIGRATION_DATABASE_URL: "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres" };
    expect(() => resolveDemoSeedTarget(env, [])).toThrow(DemoTargetRefusedError);
    expect(resolveDemoSeedTarget(env, ["--i-know"])).toBe(env.MIGRATION_DATABASE_URL);
  });

  it("only takes TEST_DATABASE_URL under NODE_ENV=test and never the app's database variables", () => {
    const local = "postgresql://postgres:postgres@127.0.0.1:58432/maet_test_demo";
    expect(() => resolveDemoSeedTarget({ TEST_DATABASE_URL: local, DATABASE_URL: local }, [])).toThrow("No migration target");
    expect(() => resolveDemoSeedTarget({ SUPABASE_DB_URL: local }, [])).toThrow("No migration target");
    expect(resolveDemoSeedTarget({ NODE_ENV: "test", TEST_DATABASE_URL: local }, [])).toBe(local);
  });

  it("makes `bun run seed:demo` exit before connecting to a production-looking database", () => {
    const started = Date.now();
    const run = Bun.spawnSync([process.execPath, "--no-env-file", "run", "server/scripts/seed-demo.ts"], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? "", MIGRATION_DATABASE_URL: "postgresql://postgres:hunter2@db.abcdefgh.supabase.co:5432/postgres" },
    });
    const stderr = run.stderr.toString();
    expect(run.exitCode).toBe(1);
    expect(stderr).toContain("Refusing to seed demo data");
    expect(stderr).not.toContain("hunter2");
    // A connection attempt would wait out the 10 s connect timeout.
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});
