/**
 * Client-side filtering strategy
 *
 * This strategy loads all tasks from the API and then applies filtering
 * logic on the client side. This is the traditional approach that works
 * with all versions of Vikunja but may be less efficient for large datasets.
 */

import type { TaskFilteringStrategy } from './TaskFilteringStrategy';
import type { FilteringParams, FilteringResult, TaskListApiParams, VikunjaTask } from './types';
import type { AuthManager } from '../../auth/AuthManager';
import { vikunjaRestRequest } from '../vikunja-rest';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../tools/tasks/validation';
import { applyFilter } from '../../tools/tasks/filtering';
import { logger } from '../logger';
import { buildTasksListQuery } from './RestCrossProjectFilteringStrategy';

/** `models.Project` per the OpenAPI spec — only the fields this module reads. */
interface VikunjaProjectSummary {
  id?: number;
  title?: string;
}

/**
 * Fetches a single project's tasks. Calls the same `GET /projects/{id}/tasks`
 * path node-vikunja's `getProjectTasks` used pre-migration — this is a
 * literal call-site migration (node-vikunja client -> `vikunjaRestRequest`),
 * not an endpoint redesign, so it is preserved byte-for-byte even though
 * `docs/vikunja-openapi.json` does not document a GET method at this path
 * (verified via `jq '.paths["/projects/{id}/tasks"]'`) — the per-view
 * `GET /projects/{id}/views/{view}/tasks` endpoint the spec does document is
 * a different, wider-scoped migration (extra view-resolution round trip,
 * different Kanban response shape per docs/API_NOTES.md) left to a future
 * item rather than folded into this refactor.
 */
async function fetchProjectTasks(
  authManager: AuthManager,
  projectId: number,
  params: TaskListApiParams,
): Promise<VikunjaTask[]> {
  // Client-side filtering never sends `filter` server-side (that's the whole
  // point of this strategy) — apiParams never carries one for this code
  // path, but the query is built explicitly without it for clarity.
  const query = buildTasksListQuery(params, undefined, {});
  const path = `/projects/${projectId}/tasks${query ? `?${query}` : ''}`;
  const tasks = await vikunjaRestRequest<VikunjaTask[]>(authManager, 'GET', path);
  return Array.isArray(tasks) ? tasks : [];
}

/**
 * Loads tasks from every project the user can access.
 *
 * Vikunja's dedicated "all tasks" endpoint (node-vikunja's `getAllTasks` ->
 * GET /tasks/all) returns HTTP 400 "Invalid model provided" on some servers
 * (reproduced on v2.3.0), so it cannot be relied on for cross-project listing.
 * This aggregates GET /projects/{id}/tasks across every project instead, which
 * is consistently available. A project that fails individually is skipped
 * rather than failing the whole listing.
 */
async function loadTasksAcrossProjects(
  authManager: AuthManager,
  params: TaskListApiParams,
): Promise<VikunjaTask[]> {
  const projects = await vikunjaRestRequest<VikunjaProjectSummary[]>(
    authManager,
    'GET',
    '/projects?per_page=1000',
  );
  const safeProjects = Array.isArray(projects) ? projects : [];

  const perProject = await Promise.all(
    safeProjects.map(async (project): Promise<VikunjaTask[]> => {
      const projectId = project.id;
      // Skip pseudo-projects (e.g. Favorites uses a negative id) to avoid duplicate tasks.
      if (typeof projectId !== 'number' || projectId <= 0) {
        return [];
      }
      try {
        return await fetchProjectTasks(authManager, projectId, params);
      } catch (error) {
        logger.warn('Skipping a project that failed during all-projects task aggregation', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    }),
  );

  return perProject.flat();
}

export class ClientSideFilteringStrategy implements TaskFilteringStrategy {
  async execute(params: FilteringParams): Promise<FilteringResult> {
    const { args, filterExpression, filterString, params: apiParams, authManager } = params;

    if (!authManager) {
      // Programmer error: FilteringContext must only select this strategy
      // when an authManager was threaded through from the tool handler.
      throw new MCPError(
        ErrorCode.INTERNAL_ERROR,
        'ClientSideFilteringStrategy requires an authManager',
      );
    }

    logger.info('Using client-side filtering', {
      filter: filterString,
      endpoint: args.projectId && !args.allProjects
        ? 'getProjectTasks'
        : 'getProjectTasks (aggregated across all projects)'
    });

    // Load tasks without server-side filtering
    let tasks;
    if (args.projectId !== undefined && !args.allProjects) {
      // Validate project ID
      validateId(args.projectId, 'projectId');
      // Get tasks for specific project without filter
      tasks = await fetchProjectTasks(authManager, args.projectId, apiParams);
    } else {
      // Aggregate tasks across all projects (GET /tasks/all is unreliable).
      tasks = await loadTasksAcrossProjects(authManager, apiParams);
    }

    logger.info('Tasks loaded for client-side filtering', {
      totalTasksLoaded: tasks?.length || 0,
      filter: filterString
    });

    // Apply client-side filtering if we have a filter expression
    const safeTasks = tasks || [];
    let filteredTasks = safeTasks;

    if (filterExpression) {
      const originalCount = safeTasks.length;
      // applyFilter's Task type comes from node-vikunja (out of this item's
      // scope — see evaluators.ts); its shape mostly matches the generated
      // model.Task, structurally-cast at this boundary.
      filteredTasks = applyFilter(
        safeTasks as unknown as Parameters<typeof applyFilter>[0],
        filterExpression,
      ) as unknown as VikunjaTask[];
      logger.debug('Applied client-side filter', {
        originalCount,
        filteredCount: filteredTasks?.length || 0,
        filter: filterString,
      });
    }

    return {
      tasks: filteredTasks || [],
      metadata: {
        serverSideFilteringUsed: false,
        serverSideFilteringAttempted: false,
        clientSideFiltering: Boolean(filterExpression),
        filteringNote: filterExpression
          ? 'Client-side filtering applied'
          : 'No filter applied; tasks returned as loaded'
      }
    };
  }
}
