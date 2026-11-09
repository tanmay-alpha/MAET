import { db } from "../../data/drizzle/client";
import { chartWorkspaces, chartPanes, chartDrawings } from "../../db/schema";
import { eq, and, desc, asc, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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

  /** Workspace and its default pane commit together; a workspace never exists without a pane. */
  async createWorkspace(userId: string, input: { name: string; layoutType?: string; activeSymbol?: string }) {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(chartWorkspaces)
        .values({
          userId,
          name: input.name,
          layoutType: input.layoutType || "SINGLE",
          activeSymbol: input.activeSymbol || "RELIANCE",
          activeExchange: "NSE",
        })
        .returning();

      await tx.insert(chartPanes).values({
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
    });
  }

  async saveLayout(userId: string, workspaceId: string, layoutType: string, panes: any[]) {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(chartWorkspaces)
        .set({
          layoutType,
          updatedAt: new Date(),
        })
        .where(and(eq(chartWorkspaces.id, workspaceId), eq(chartWorkspaces.userId, userId)))
        .returning({ id: chartWorkspaces.id });
      // Without this, a foreign workspaceId would still get panes inserted under it.
      if (updated.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      // The stored panes become exactly the submitted ones: drop every pane of
      // this workspace the request no longer references, then update/insert.
      const submitted = panes.slice(0, 4);
      const keptIds: string[] = submitted.flatMap((pane) => (pane.id ? [pane.id] : []));
      const scope = and(eq(chartPanes.workspaceId, workspaceId), eq(chartPanes.userId, userId));
      await tx
        .delete(chartPanes)
        .where(keptIds.length > 0 ? and(scope, notInArray(chartPanes.id, keptIds)) : scope);

      for (let i = 0; i < submitted.length; i++) {
        const pane = submitted[i];
        if (pane.id) {
          const matched = await tx
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
            .where(and(eq(chartPanes.id, pane.id), scope))
            .returning({ id: chartPanes.id });
          if (matched.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Pane not found" });
          }
        } else {
          await tx.insert(chartPanes).values({
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
    });
  }

  async deleteWorkspace(userId: string, workspaceId: string) {
    await db
      .delete(chartWorkspaces)
      .where(and(eq(chartWorkspaces.id, workspaceId), eq(chartWorkspaces.userId, userId)));
  }
}

export const chartWorkspaceRepository = new ChartWorkspaceRepository();
