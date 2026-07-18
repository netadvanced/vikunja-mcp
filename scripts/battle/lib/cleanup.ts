/**
 * Prefix-based cleanup for battle-testing scenario data, run before AND
 * after every scenario (see docs/BATTLE-TESTING.md). Idempotent and
 * safe to run against a stack with zero matching data.
 *
 * Sweeps ONLY rows whose title starts with the given prefix (a full
 * `battle-<runid>-` run prefix, or the bare `battle-` root to catch
 * leftovers from a previous crashed run under a different run id) -- never
 * touches unrelated data such as the e2e stack's own `Inbox`/`MCP-Test`
 * fixtures from other harnesses.
 */

import type { VikunjaRestClient } from './rest-client';

export interface CleanupResult {
  deletedProjects: number;
  deletedLabels: number;
  errors: string[];
}

export async function cleanupByPrefix(client: VikunjaRestClient, prefix: string): Promise<CleanupResult> {
  const errors: string[] = [];
  let deletedProjects = 0;
  let deletedLabels = 0;

  const projects = await client.listProjects();
  for (const project of projects) {
    if (!project.title.startsWith(prefix)) continue;
    try {
      const tasks = await client.listTasksInProject(project.id);
      for (const task of tasks) {
        try {
          await client.deleteTask(task.id);
        } catch (e) {
          errors.push(`delete task ${task.id} (project "${project.title}"): ${(e as Error).message}`);
        }
      }
      await client.deleteProject(project.id);
      deletedProjects += 1;
    } catch (e) {
      errors.push(`delete project "${project.title}" (id ${project.id}): ${(e as Error).message}`);
    }
  }

  const labels = await client.listLabels();
  for (const label of labels) {
    if (!label.title.startsWith(prefix)) continue;
    try {
      await client.deleteLabel(label.id);
      deletedLabels += 1;
    } catch (e) {
      errors.push(`delete label "${label.title}" (id ${label.id}): ${(e as Error).message}`);
    }
  }

  return { deletedProjects, deletedLabels, errors };
}
