/**
 * Strategy versions — PostgreSQL integration tests for the definition hash.
 *
 * createVersion refuses (CONFLICT) a draft identical to an existing version, and the unique index
 * (strategy_id, definition_hash) backs that up. The hash must therefore cover the whole definition:
 * a draft that differs only in a nested rule or risk value is a new version, not a conflict.
 * Skipped without TEST_DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import * as service from "./service";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const userId = "00000000-0000-0000-0000-0000000000d8";

const definition: StrategyDefinition = {
  name: "versioned",
  direction: "LONG_ONLY",
  universe: { type: "SINGLE_SYMBOL", symbolOrId: "RELIANCE" },
  timeframe: "1d",
  entry: {
    kind: "GROUP", id: "e", combinator: "AND",
    children: [{ kind: "CONDITION", id: "e1", left: { kind: "INDICATOR", indicator: "SMA", params: { period: 5 }, lag: 0 }, operator: "CROSS_ABOVE", right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 }, lag: 0 } }],
  },
  exit: {
    kind: "GROUP", id: "x", combinator: "AND",
    children: [{ kind: "CONDITION", id: "x1", left: { kind: "INDICATOR", indicator: "SMA", params: { period: 5 }, lag: 0 }, operator: "CROSS_BELOW", right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 }, lag: 0 } }],
  },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, stopLossPercent: 5, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5, initialCapital: 100_000 },
};

async function setDraft(strategyId: string, draft: unknown) {
  const sql = getSqlClient();
  await sql`UPDATE public.strategy_definitions SET current_draft = ${JSON.stringify(draft)}::jsonb WHERE id = ${strategyId}`;
}

async function trpcCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof TRPCError) return err.code;
    throw err;
  }
}

describe.skipIf(!enabled)("strategy versions — definition hash (PostgreSQL)", () => {
  beforeAll(async () => {
    await applyMigrations();
    const sql = getSqlClient();
    await sql.unsafe(`
      DELETE FROM public.users WHERE id = '${userId}';
      DELETE FROM auth.users WHERE id = '${userId}';
      INSERT INTO auth.users (id) VALUES ('${userId}');
      INSERT INTO public.users (id, email) VALUES ('${userId}', 'versions-hash@test.com');
    `);
  });

  afterAll(async () => {
    const sql = getSqlClient();
    await sql.unsafe(`
      DELETE FROM public.users WHERE id = '${userId}';
      DELETE FROM auth.users WHERE id = '${userId}';
    `);
  });

  it("conflicts only on an identical definition, whatever the key order", async () => {
    const strategy = await service.createStrategy(userId, "Versioned", undefined, definition);
    const v1 = await service.createVersion(userId, strategy.id);
    expect(v1.definitionHash).toMatch(/^[0-9a-f]{64}$/);

    expect(await trpcCode(service.createVersion(userId, strategy.id))).toBe("CONFLICT");

    // Differs only inside the exit rule: a new version, not a conflict.
    const slowerExit = structuredClone(definition);
    const exitCondition = slowerExit.exit.children[0];
    if (exitCondition.kind === "CONDITION" && exitCondition.right.kind === "INDICATOR") exitCondition.right.params.period = 30;
    await setDraft(strategy.id, slowerExit);
    const v2 = await service.createVersion(userId, strategy.id);
    expect(v2.definitionHash).not.toBe(v1.definitionHash);

    // Differs only in a risk value.
    await setDraft(strategy.id, { ...definition, risk: { ...definition.risk, stopLossPercent: 6 } });
    const v3 = await service.createVersion(userId, strategy.id);
    expect(new Set([v1.definitionHash, v2.definitionHash, v3.definitionHash]).size).toBe(3);

    // The v1 definition again, keys reversed at the top level and inside risk: still v1.
    const reordered = Object.fromEntries(Object.entries({ ...definition, risk: Object.fromEntries(Object.entries(definition.risk).reverse()) }).reverse());
    await setDraft(strategy.id, reordered);
    expect(await trpcCode(service.createVersion(userId, strategy.id))).toBe("CONFLICT");
  });

  it("refuses to version a stored draft with settings the engine does not implement", async () => {
    const strategy = await service.createStrategy(userId, "Legacy", undefined, definition);
    await setDraft(strategy.id, { ...definition, risk: { ...definition.risk, allowPyramiding: true, maximumPyramids: 2 } });
    expect(await trpcCode(service.createVersion(userId, strategy.id))).toBe("BAD_REQUEST");
  });
});
