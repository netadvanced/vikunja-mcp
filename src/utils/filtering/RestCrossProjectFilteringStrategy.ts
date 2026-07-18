/**
 * REST cross-project filtering strategy
 *
 * Vikunja documents a single-call `GET /tasks` endpoint for listing tasks
 * across every project the user can access, with `page`, `per_page`, `s`,
 * `sort_by`, `order_by`, `filter`, `filter_timezone`, `filter_include_nulls`
 * and `expand` query params (see docs/vikunja-openapi.json). Neither
 * node-vikunja's `getAllTasks` (which calls the non-existent `GET
 * /tasks/all`, confirmed to 400 "Invalid model provided" on real servers —
 * see `ClientSideFilteringStrategy`) nor any other code path in this
 * project ever called the real endpoint.
 *
 * This strategy calls `GET /tasks` directly via `vikunjaRestRequest` and is
 * the PRIMARY strategy for cross-project ("all projects" or no `projectId`)
 * listing — one call instead of an N+1 per-project aggregation. If the
 * direct call fails for any reason (older server without the endpoint, the
 * circuit breaker open, a transient network error surviving retries, etc.)
 * it falls back to the existing per-project aggregation
 * (`ClientSideFilteringStrategy`, which itself applies `filterExpression`
 * client-side), kept as the documented fallback per
 * docs/ENDPOINT-PLAYBOOK.md's hybrid pattern — the fallback matters if some
 * server versions reject `GET /tasks`.
 *
 * Single-project listing is untouched by this strategy: it is only selected
 * by `FilteringContext` when the listing is cross-project.
 */

import type { TaskFilteringStrategy } from './TaskFilteringStrategy';
import type { FilteringArgs, FilteringParams, FilteringResult, TaskListApiParams, VikunjaTask } from './types';
import { ClientSideFilteringStrategy } from './ClientSideFilteringStrategy';
import { vikunjaRestRequest } from '../vikunja-rest';
import { MCPError, ErrorCode } from '../../types';
import { logger } from '../logger';

/**
 * Builds the `GET /tasks` query string from the shared API params plus the
 * task-list-only extras (`order_by`, `filter_timezone`,
 * `filter_include_nulls`, `expand`) — single-project listing
 * (`ClientSideFilteringStrategy`/`ServerSideFilteringStrategy`) does not
 * honor these, since they were never part of node-vikunja's `GetTasksParams`
 * shape that the pre-migration single-project call sites used (see
 * docs/ENDPOINT-PLAYBOOK.md's direct-REST rule).
 */
export function buildTasksListQuery(
  apiParams: TaskListApiParams,
  filterString: string | undefined,
  args: FilteringArgs,
): string {
  const query = new URLSearchParams();
  if (apiParams.page !== undefined) query.set('page', String(apiParams.page));
  if (apiParams.per_page !== undefined) query.set('per_page', String(apiParams.per_page));
  if (apiParams.s !== undefined) query.set('s', String(apiParams.s));
  if (apiParams.sort_by !== undefined) query.set('sort_by', String(apiParams.sort_by));
  if (filterString) query.set('filter', filterString);
  if (args.orderBy) query.set('order_by', args.orderBy);
  if (args.filterTimezone) query.set('filter_timezone', args.filterTimezone);
  if (args.filterIncludeNulls !== undefined) {
    query.set('filter_include_nulls', args.filterIncludeNulls ? 'true' : 'false');
  }
  if (args.expand && args.expand.length > 0) {
    for (const value of args.expand) {
      query.append('expand', value);
    }
  }
  return query.toString();
}

export class RestCrossProjectFilteringStrategy implements TaskFilteringStrategy {
  async execute(params: FilteringParams): Promise<FilteringResult> {
    const { authManager, filterString, args, params: apiParams } = params;

    if (!authManager) {
      // Programmer error: FilteringContext must only select this strategy
      // when an authManager was threaded through from the tool handler.
      throw new MCPError(
        ErrorCode.INTERNAL_ERROR,
        'RestCrossProjectFilteringStrategy requires an authManager',
      );
    }

    const query = buildTasksListQuery(apiParams, filterString, args);
    const path = `/tasks${query ? `?${query}` : ''}`;

    try {
      logger.info('Attempting cross-project task listing via direct REST GET /tasks', {
        filter: filterString,
        path,
      });

      const tasks = await vikunjaRestRequest<VikunjaTask[]>(authManager, 'GET', path);
      const safeTasks = Array.isArray(tasks) ? tasks : [];

      logger.info('Direct REST GET /tasks succeeded for cross-project listing', {
        taskCount: safeTasks.length,
      });

      return {
        tasks: safeTasks,
        metadata: {
          serverSideFilteringUsed: Boolean(filterString),
          serverSideFilteringAttempted: true,
          clientSideFiltering: false,
          filteringNote: filterString
            ? 'Server-side filtering used via direct REST GET /tasks'
            : 'Cross-project listing via direct REST GET /tasks (single call, no per-project aggregation)',
        },
      };
    } catch (error) {
      logger.warn(
        'Direct REST GET /tasks failed for cross-project listing, falling back to per-project aggregation',
        {
          error: error instanceof Error ? error.message : String(error),
          filter: filterString,
        },
      );

      const fallbackResult = await new ClientSideFilteringStrategy().execute(params);

      return {
        ...fallbackResult,
        metadata: {
          ...fallbackResult.metadata,
          serverSideFilteringAttempted: true,
          filteringNote:
            'Direct REST GET /tasks failed; used per-project aggregation fallback',
        },
      };
    }
  }
}
