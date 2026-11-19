import { beforeAll, describe, expect, it } from "bun:test";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { createVersion } from "./repository";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

const USER = "00000000-0000-0000-0000-0000000000d1";
const definition = { name: "versions test" } as unknown as StrategyDefinition;

async function seedStrategy(id: string) {
  await getSqlClient().unsafe(`
    INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
    VALUES ('${id}', '${USER}', 'versions', '{}') ON CONFLICT (id) DO NOTHING;
    DELETE FROM public.strategy_versions WHERE strategy_id = '${id}';
  `);
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("strategy version numbering (Postgres)", () => {
  beforeAll(async () => {
    await applyMigrations();
    await getSqlClient().unsafe(`
      INSERT INTO auth.users (id) VALUES ('${USER}') ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, email) VALUES ('${USER}', 'versions@test.com') ON CONFLICT DO NOTHING;
    `);
  });

  it("assigns consecutive, unique numbers to concurrent versions of one strategy", async () => {
    const strategyId = "d1000000-0000-0000-0000-000000000001";
    await seedStrategy(strategyId);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createVersion(USER, strategyId, definition, `hash-${i}`, "3", "1")),
    );

    const numbers = results.map((r) => ("created" in r ? r.created.versionNumber : -1)).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("reports a concurrent identical definition as a duplicate instead of a unique-index error", async () => {
    const strategyId = "d1000000-0000-0000-0000-000000000002";
    await seedStrategy(strategyId);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => createVersion(USER, strategyId, definition, "same-hash", "3", "1")),
    );

    expect(results.filter((r) => "created" in r)).toHaveLength(1);
    expect(results.filter((r) => "duplicateOf" in r)).toHaveLength(3);
  });

  it("numbers after the highest existing version, not the row count", async () => {
    const strategyId = "d1000000-0000-0000-0000-000000000003";
    await seedStrategy(strategyId);
    await createVersion(USER, strategyId, definition, "a", "3", "1");
    await createVersion(USER, strategyId, definition, "b", "3", "1");
    await getSqlClient().unsafe(`DELETE FROM public.strategy_versions WHERE strategy_id = '${strategyId}' AND version_number = 1`);

    const next = await createVersion(USER, strategyId, definition, "c", "3", "1");
    expect("created" in next && next.created.versionNumber).toBe(3);
  });
});
