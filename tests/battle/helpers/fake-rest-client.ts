import type {
  VikunjaBucket,
  VikunjaLabel,
  VikunjaProject,
  VikunjaProjectView,
  VikunjaRestClient,
  VikunjaShare,
  VikunjaTask,
} from '../../../scripts/battle/lib/rest-client';

/**
 * Lightweight in-memory fake implementing `VikunjaRestClient`, shared by
 * verify.test.ts and cleanup.test.ts so both exercise the same fake
 * semantics against a plain object graph instead of a live server.
 */
export class FakeRestClient implements VikunjaRestClient {
  projects: VikunjaProject[] = [];
  tasksByProject: Record<number, VikunjaTask[]> = {};
  labels: VikunjaLabel[] = [];
  views: Record<number, VikunjaProjectView[]> = {};
  buckets: Record<number, VikunjaBucket[]> = {};
  shares: Record<number, VikunjaShare[]> = {};
  labelsByTask: Record<number, VikunjaLabel[]> = {};
  deletedTaskIds: number[] = [];
  deletedProjectIds: number[] = [];
  deletedLabelIds: number[] = [];
  failDeleteProjectIds: Set<number> = new Set();
  failCreateLabelTitles: Set<string> = new Set();
  createdLabels: VikunjaLabel[] = [];
  private nextLabelId = 1000;

  request<T>(): Promise<T> {
    throw new Error('not used in these tests');
  }

  async requestOrEmpty<T>(path: string): Promise<T[]> {
    const match = /^\/tasks\/(\d+)\/labels$/.exec(path);
    if (match) {
      return (this.labelsByTask[Number(match[1])] ?? []) as unknown as T[];
    }
    return [];
  }

  async listProjects(): Promise<VikunjaProject[]> {
    return this.projects;
  }

  async listTasksInProject(projectId: number): Promise<VikunjaTask[]> {
    return this.tasksByProject[projectId] ?? [];
  }

  async getTask(taskId: number): Promise<VikunjaTask> {
    for (const tasks of Object.values(this.tasksByProject)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) return found;
    }
    throw new Error(`task ${taskId} not found`);
  }

  async listLabels(): Promise<VikunjaLabel[]> {
    return this.labels;
  }

  async listViews(projectId: number): Promise<VikunjaProjectView[]> {
    return this.views[projectId] ?? [];
  }

  async listBuckets(projectId: number): Promise<VikunjaBucket[]> {
    return this.buckets[projectId] ?? [];
  }

  async listShares(projectId: number): Promise<VikunjaShare[]> {
    return this.shares[projectId] ?? [];
  }

  async deleteTask(taskId: number): Promise<void> {
    this.deletedTaskIds.push(taskId);
  }

  async deleteProject(projectId: number): Promise<void> {
    if (this.failDeleteProjectIds.has(projectId)) {
      throw new Error(`simulated failure deleting project ${projectId}`);
    }
    this.deletedProjectIds.push(projectId);
  }

  async deleteLabel(labelId: number): Promise<void> {
    this.deletedLabelIds.push(labelId);
  }

  async createLabel(title: string): Promise<VikunjaLabel> {
    if (this.failCreateLabelTitles.has(title)) {
      throw new Error(`simulated failure creating label "${title}"`);
    }
    const label: VikunjaLabel = { id: this.nextLabelId++, title };
    this.createdLabels.push(label);
    this.labels.push(label);
    return label;
  }
}
