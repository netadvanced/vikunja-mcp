/**
 * Type definitions for the filtering strategy pattern
 */

import type { FilterExpression } from '../../types/filters';
import type { AuthManager } from '../../auth/AuthManager';
import type { components } from '../../types/generated/vikunja-openapi';

/** `models.Task` per the OpenAPI spec. */
export type VikunjaTask = components['schemas']['models.Task'];

/**
 * Query params shared by the task-listing endpoints (page/per_page/s/sort_by
 * plus the server-side `filter` string). Mirrors node-vikunja's
 * `GetTasksParams` shape without depending on the (EOL) node-vikunja package.
 */
export interface TaskListApiParams {
  page?: number;
  per_page?: number;
  s?: string;
  sort_by?: string;
  filter?: string;
}

/**
 * Arguments for filtering operations
 */
export interface FilteringArgs {
  projectId?: number;
  page?: number;
  perPage?: number;
  search?: string;
  sort?: string;
  filter?: string;
  filterId?: string;
  allProjects?: boolean;
  done?: boolean;
  /**
   * The documented GET /tasks `order_by` param ('asc' | 'desc', paired with
   * `sort_by`). Only honored by `RestCrossProjectFilteringStrategy` —
   * single-project listing (`ClientSideFilteringStrategy`/
   * `ServerSideFilteringStrategy`) never supported this param even
   * pre-migration, so it stays REST-cross-project-only to preserve exact
   * behavior.
   */
  orderBy?: 'asc' | 'desc';
  /** GET /tasks `filter_timezone` param. Same REST-only scope as `orderBy`. */
  filterTimezone?: string;
  /** GET /tasks `filter_include_nulls` param. Same REST-only scope as `orderBy`. */
  filterIncludeNulls?: boolean;
  /** GET /tasks `expand` param (repeatable). Same REST-only scope as `orderBy`. */
  expand?: string[];
}

/**
 * Parameters passed to filtering strategies
 */
export interface FilteringParams {
  args: FilteringArgs;
  filterExpression: FilterExpression | null;
  filterString: string | undefined;
  params: TaskListApiParams;
  /**
   * Active auth manager, required by strategies that call the direct-REST
   * helper (`RestCrossProjectFilteringStrategy`). Kept as its own field
   * rather than folded into `args` so that logging/debugging code that logs
   * `args` wholesale never accidentally serializes session credentials.
   */
  authManager?: AuthManager;
}

/**
 * Metadata about the filtering operation performed
 */
export interface FilteringMetadata {
  serverSideFilteringUsed: boolean;
  serverSideFilteringAttempted: boolean;
  clientSideFiltering: boolean;
  filteringNote: string;
}

/**
 * Result of a filtering operation
 */
export interface FilteringResult {
  tasks: VikunjaTask[];
  metadata: FilteringMetadata;
}

/**
 * Configuration for strategy selection
 */
export interface StrategyConfig {
  enableServerSide: boolean;
  /**
   * True when the listing spans every accessible project (no `projectId`,
   * or `allProjects: true`). Cross-project listing always routes through
   * `RestCrossProjectFilteringStrategy` (direct REST GET /tasks, falling
   * back to per-project aggregation), regardless of `enableServerSide` —
   * the documented single-call endpoint is strictly better than the N+1
   * aggregation whether or not a filter is present.
   */
  crossProject?: boolean;
}

/**
 * Task filtering strategy interface
 */
export interface TaskFilteringStrategy {
  /**
   * Execute the filtering strategy
   * @param params - Filtering parameters
   * @returns Promise resolving to filtering result
   */
  execute(params: FilteringParams): Promise<FilteringResult>;
}