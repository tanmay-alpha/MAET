import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chartWorkspacesRouter } from "../../api/trpc/routers/chart-workspaces";
import { tradeThesesRouter } from "../../api/trpc/routers/trade-theses";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const ctx = (userId: string) => ({ userId, email: `${userId}@example.com`, role: "user" as const });

async function expectNotFound(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ code: "NOT_FOUND" });
    return;
  }
  throw new Error("Expected NOT_FOUND");
}

describe.skipIf(!databaseUrl)("research ownership checks (PostgreSQL)", () => {
  beforeAll(async () => {
    await applyMigrations();
    const sql = getSqlClient();
    await sql`INSERT INTO auth.users (id) VALUES (${userA}), (${userB}) ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO public.users (id, email)
      VALUES (${userA}, ${`own-a-${userA}@example.com`}), (${userB}, ${`own-b-${userB}@example.com`})
    `;
  }, 120_000);

  afterAll(async () => {
    const sql = getSqlClient();
    await sql`DELETE FROM public.users WHERE id IN (${userA}, ${userB})`;
    await sql`DELETE FROM auth.users WHERE id IN (${userA}, ${userB})`;
  });

  it("rejects a thesis attached to another user's chart workspace", async () => {
    const workspaceB = await chartWorkspacesRouter.createCaller(ctx(userB)).create({ name: "B" });
    const thesesA = tradeThesesRouter.createCaller(ctx(userA));
    const base = { symbol: "TCS", title: "t", setupType: "breakout", direction: "LONG" as const, hypothesis: "h" };

    await expectNotFound(thesesA.create({ ...base, workspaceId: workspaceB.id }));
    const workspaceA = await chartWorkspacesRouter.createCaller(ctx(userA)).create({ name: "A" });
    expect((await thesesA.create({ ...base, workspaceId: workspaceA.id })).workspaceId).toBe(workspaceA.id);
  });

  it("rejects linking another user's paper order to a thesis", async () => {
    const sql = getSqlClient();
    const [orderB] = await sql<{ id: string }[]>`
      INSERT INTO public.paper_orders (user_id, symbol, side, type, qty)
      VALUES (${userB}, 'TCS', 'BUY', 'MARKET', 1) RETURNING id
    `;
    const [orderA] = await sql<{ id: string }[]>`
      INSERT INTO public.paper_orders (user_id, symbol, side, type, qty)
      VALUES (${userA}, 'TCS', 'BUY', 'MARKET', 1) RETURNING id
    `;
    const thesesA = tradeThesesRouter.createCaller(ctx(userA));
    const thesis = await thesesA.create({ symbol: "TCS", title: "t", setupType: "s", direction: "LONG", hypothesis: "h" });

    await expectNotFound(thesesA.linkOrder({ thesisId: thesis.id, paperOrderId: orderB.id, relationship: "ENTRY" }));
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.thesis_order_links WHERE paper_order_id = ${orderB.id}
    `;
    expect(count).toBe(0);

    const link = await thesesA.linkOrder({ thesisId: thesis.id, paperOrderId: orderA.id, relationship: "ENTRY" });
    expect(link.paperOrderId).toBe(orderA.id);
  });

  it("saveLayout on another user's workspace is NOT_FOUND and inserts no panes", async () => {
    const sql = getSqlClient();
    const workspaceB = await chartWorkspacesRouter.createCaller(ctx(userB)).create({ name: "B2" });
    const callerA = chartWorkspacesRouter.createCaller(ctx(userA));

    await expectNotFound(
      callerA.saveLayout({ workspaceId: workspaceB.id, layoutType: "VERTICAL_2", panes: [{ symbol: "INFY" }] })
    );
    const panes = await sql<{ user_id: string }[]>`
      SELECT user_id FROM public.chart_panes WHERE workspace_id = ${workspaceB.id}
    `;
    expect(panes.map((pane) => pane.user_id)).toEqual([userB]);
  });

  it("rejects unbounded indicator payloads", async () => {
    const workspaceA = await chartWorkspacesRouter.createCaller(ctx(userA)).create({ name: "A2" });
    const callerA = chartWorkspacesRouter.createCaller(ctx(userA));
    const indicator = { id: "i", type: "SMA" as const, parameters: { period: 20 } };
    await expect(
      callerA.saveLayout({
        workspaceId: workspaceA.id,
        layoutType: "SINGLE",
        panes: [{ symbol: "INFY", indicators: Array.from({ length: 21 }, () => indicator) }],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerA.saveLayout({
        workspaceId: workspaceA.id,
        layoutType: "SINGLE",
        // @ts-expect-error nested objects are not valid indicator parameters
        panes: [{ symbol: "INFY", indicators: [{ ...indicator, parameters: { blob: { x: "y".repeat(1000) } } }] }],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await callerA.saveLayout({ workspaceId: workspaceA.id, layoutType: "SINGLE", panes: [{ symbol: "INFY", indicators: [indicator] }] })
    ).toEqual({ success: true });
  });

  it("saveLayout replaces the stored panes with exactly the submitted set", async () => {
    const sql = getSqlClient();
    const callerA = chartWorkspacesRouter.createCaller(ctx(userA));
    const workspace = await callerA.create({ name: "A3" });
    const storedPanes = () => sql<{ id: string; symbol: string }[]>`
      SELECT id, symbol FROM public.chart_panes WHERE workspace_id = ${workspace.id} ORDER BY position
    `;

    const twoPanes = { workspaceId: workspace.id, layoutType: "VERTICAL_2" as const, panes: [{ symbol: "INFY" }, { symbol: "TCS" }] };
    await callerA.saveLayout(twoPanes);
    await callerA.saveLayout(twoPanes);
    const saved = await storedPanes();
    expect(saved.map((pane) => pane.symbol)).toEqual(["INFY", "TCS"]);

    await callerA.saveLayout({ workspaceId: workspace.id, layoutType: "SINGLE", panes: [{ id: saved[1].id, symbol: "WIPRO" }] });
    expect(await storedPanes()).toEqual([{ id: saved[1].id, symbol: "WIPRO" }]);

    await expect(
      callerA.saveLayout({ workspaceId: workspace.id, layoutType: "SINGLE", panes: [{ symbol: "INFY", paneKey: "k".repeat(31) }] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerA.saveLayout({ workspaceId: workspace.id, layoutType: "SINGLE", panes: [{ id: "not-a-uuid-pane-id", symbol: "INFY" }] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps chart workspace and thesis service failures to client error codes", async () => {
    const sql = getSqlClient();
    const callerB = chartWorkspacesRouter.createCaller(ctx(userB));
    await expectNotFound(callerB.get({ id: crypto.randomUUID() }));

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.chart_workspaces WHERE user_id = ${userB}
    `;
    for (let i = count; i < 20; i++) await callerB.create({ name: `cap-${i}` });
    await expect(callerB.create({ name: "over-cap" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    const thesesB = tradeThesesRouter.createCaller(ctx(userB));
    await expect(
      thesesB.create({ symbol: "TCS", title: "t", setupType: "s", direction: "LONG", hypothesis: "h", stopPrice: 110, targetPrice: 100 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
