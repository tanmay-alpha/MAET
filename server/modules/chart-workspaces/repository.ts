import { db } from "../../data/drizzle/client";
import { chartWorkspaces, chartPanes, chartDrawings } from "../../db/schema";
import { eq, and, desc, asc } from "drizzle-orm";

export class ChartWorkspaceRepository {
  async listWorkspaces(userId: string) {
    return db
      .select()
      .from(chartWorkspaces)
      .where(eq(chartWorkspaces.userId, userId))
      .orderBy(desc(chartWorkspaces.updatedAt));
  }

  async getWorkspaceById(userId: string, workspaceId: string) {
    const [workspace] = await db
      .select()
      .from(chartWorkspaces)
      .where(and(eq(chartWorkspaces.id, workspaceId), eq(chartWorkspaces.userId, userId)));

    if (!workspace) return null;

    const panes = await db
      .select()
      .from(chartPanes)
      .where(and(eq(chartPanes.workspaceId, workspaceId), eq(chartPanes.userId, userId)))
      .orderBy(asc(chartPanes.position));

    const drawings = await db
      .select()
      .from(chartDrawings)
      .where(and(eq(chartDrawings.workspaceId, workspaceId), eq(chartDrawings.userId, userId)));

    return {
      ...workspace,
      panes: panes.map((p: any) => ({
        ...p,
        indicators: (p.settings as any)?.indicators || [],
        drawings: drawings.filter((d: any) => d.paneId === p.id || !d.paneId),
      })),
    };
  }

  async createWorkspace(userId: string, input: { name: string; layoutType?: string; activeSymbol?: string }) {
    const [created] = await db
      .insert(chartWorkspaces)
      .values({
        userId,
        name: input.name,
        layoutType: input.layoutType || "SINGLE",
        activeSymbol: input.activeSymbol || "RELIANCE",
        activeExchange: "NSE",
      })
      .returning();

    // Default pane
    await db.insert(chartPanes).values({
      workspaceId: created.id,
      userId,
      paneKey: "pane-1",
      symbol: created.activeSymbol,
      exchange: "NSE",
      timeframe: "5m",
      chartType: "CANDLE",
      position: 0,
    });

    return created;
  }

  async saveLayout(userId: string, workspaceId: string, layoutType: string, panes: any[]) {
    await db
      .update(chartWorkspaces)
      .set({
        layoutType,
        updatedAt: new Date(),
      })
      .where(and(eq(chartWorkspaces.id, workspaceId), eq(chartWorkspaces.userId, userId)));

    // Upsert panes
    for (let i = 0; i < Math.min(panes.length, 4); i++) {
      const pane = panes[i];
      if (pane.id && pane.id.length > 10) {
        await db
          .update(chartPanes)
          .set({
            symbol: pane.symbol,
            exchange: pane.exchange || "NSE",
            timeframe: pane.timeframe || "5m",
            chartType: pane.chartType || "CANDLE",
            position: i,
            settings: { indicators: pane.indicators || [] },
            updatedAt: new Date(),
          })
          .where(and(eq(chartPanes.id, pane.id), eq(chartPanes.userId, userId)));
      } else {
        await db.insert(chartPanes).values({
          workspaceId,
          userId,
          paneKey: pane.paneKey || `pane-${i + 1}`,
          symbol: pane.symbol,
          exchange: pane.exchange || "NSE",
          timeframe: pane.timeframe || "5m",
          chartType: pane.chartType || "CANDLE",
          position: i,
          settings: { indicators: pane.indicators || [] },
        });
      }
    }
  }

  async deleteWorkspace(userId: string, workspaceId: string) {
    await db
      .delete(chartWorkspaces)
      .where(and(eq(chartWorkspaces.id, workspaceId), eq(chartWorkspaces.userId, userId)));
  }
}

export const chartWorkspaceRepository = new ChartWorkspaceRepository();
