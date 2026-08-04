import { chartWorkspaceRepository } from "./repository";

export class ChartWorkspaceService {
  async getUserWorkspaces(userId: string) {
    return chartWorkspaceRepository.listWorkspaces(userId);
  }

  async getWorkspaceDetails(userId: string, workspaceId: string) {
    const ws = await chartWorkspaceRepository.getWorkspaceById(userId, workspaceId);
    if (!ws) {
      throw new Error("Workspace not found or unauthorized.");
    }
    return ws;
  }

  async createWorkspace(userId: string, name: string, layoutType: string = "SINGLE") {
    const existing = await chartWorkspaceRepository.listWorkspaces(userId);
    if (existing.length >= 20) {
      throw new Error("Maximum workspace limit of 20 reached.");
    }
    return chartWorkspaceRepository.createWorkspace(userId, { name, layoutType });
  }

  async saveLayout(userId: string, workspaceId: string, layoutType: string, panes: any[]) {
    if (panes.length > 4) {
      throw new Error("Maximum 4 panes allowed per layout.");
    }
    return chartWorkspaceRepository.saveLayout(userId, workspaceId, layoutType, panes);
  }

  async deleteWorkspace(userId: string, workspaceId: string) {
    return chartWorkspaceRepository.deleteWorkspace(userId, workspaceId);
  }
}

export const chartWorkspaceService = new ChartWorkspaceService();
