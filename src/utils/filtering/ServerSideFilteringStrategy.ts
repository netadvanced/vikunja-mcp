/**
 * Server-side filtering strategy
 *
 * This strategy attempts to use Vikunja's server-side filtering capabilities
 * by passing filter parameters directly to the API. This is the most efficient
 * approach when the server supports advanced filtering.
 */

import type { TaskFilteringStrategy } from './TaskFilteringStrategy';
import type { FilteringParams, FilteringResult, VikunjaTask } from './types';
import { vikunjaRestRequest } from '../vikunja-rest';
import { validateId } from '../../tools/tasks/validation';
import { logger } from '../logger';
import { MCPError, ErrorCode } from '../../types';
import { buildTasksListQuery } from './RestCrossProjectFilteringStrategy';

export class ServerSideFilteringStrategy implements TaskFilteringStrategy {
  async execute(params: FilteringParams): Promise<FilteringResult> {
    const { args, filterString, params: apiParams, authManager } = params;

    if (!filterString) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Server-side filtering requires a filter string'
      );
    }

    if (!authManager) {
      // Programmer error: FilteringContext must only select this strategy
      // (via HybridFilteringStrategy) when an authManager was threaded
      // through from the tool handler.
      throw new MCPError(
        ErrorCode.INTERNAL_ERROR,
        'ServerSideFilteringStrategy requires an authManager',
      );
    }

    const query = buildTasksListQuery(apiParams, filterString, {});
    const singleProject = args.projectId !== undefined && !args.allProjects;

    logger.info('Attempting server-side filtering', {
      filter: filterString,
      endpoint: singleProject ? 'getProjectTasks' : 'getAllTasks'
    });

    let tasks;
    try {
      if (singleProject && args.projectId !== undefined) {
        // Validate project ID
        validateId(args.projectId, 'projectId');
        // Get tasks for specific project with server-side filter. Calls the
        // same `GET /projects/{id}/tasks` path node-vikunja's
        // `getProjectTasks` used pre-migration — a literal call-site
        // migration, not an endpoint redesign (see
        // ClientSideFilteringStrategy's `fetchProjectTasks` doc comment for
        // why the spec's `get?: never` at this path doesn't block reusing it
        // here).
        const path = `/projects/${args.projectId}/tasks${query ? `?${query}` : ''}`;
        tasks = await vikunjaRestRequest<VikunjaTask[]>(authManager, 'GET', path);
      } else {
        // Get all tasks across all projects with server-side filter. Calls
        // the same (non-existent, confirmed 400 "Invalid model provided" on
        // real servers) `GET /tasks/all` path node-vikunja's `getAllTasks`
        // used pre-migration. This branch is unreachable in production —
        // `FilteringContext` always routes cross-project listings through
        // `RestCrossProjectFilteringStrategy` (real `GET /tasks`) before
        // this strategy is ever selected — but the literal call-site
        // migration is preserved rather than silently redirected to a
        // different, working endpoint, per this item's byte-compatible
        // refactor-not-redesign scope.
        const path = `/tasks/all${query ? `?${query}` : ''}`;
        tasks = await vikunjaRestRequest<VikunjaTask[]>(authManager, 'GET', path);
      }

      logger.info('Server-side filtering completed successfully', {
        taskCount: tasks?.length || 0,
        filter: filterString
      });

      return {
        tasks: tasks || [],
        metadata: {
          serverSideFilteringUsed: true,
          serverSideFilteringAttempted: true,
          clientSideFiltering: false,
          filteringNote: 'Server-side filtering used (modern Vikunja)'
        }
      };

    } catch (error) {
      logger.error('Server-side filtering failed', {
        error: error instanceof Error ? error.message : String(error),
        filter: filterString
      });

      // Re-throw the error to be handled by the calling code
      throw error;
    }
  }
}
