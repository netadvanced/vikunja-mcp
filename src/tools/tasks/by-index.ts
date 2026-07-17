/**
 * Task by-index lookup
 *
 * Implements `get-by-index`, which resolves a task by its human-facing
 * per-project index (`GET /projects/{project}/tasks/by-index/{index}`) —
 * useful for resolving references like "PROJ-42" to a canonical task
 * object. Per the spec, task indexes are reassigned when a task moves
 * between projects, so long-lived references should use the returned
 * task's numeric `id` instead of re-resolving by index later.
 *
 * node-vikunja does not expose this endpoint, so this calls the Vikunja
 * REST API directly via the shared `vikunja-rest` helper.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';

export interface GetTaskByIndexArgs {
  /** Numeric id of the project the task's index is scoped to. */
  projectId?: number;
  /** The task's per-project index (e.g. the "42" in "PROJ-42"). */
  index?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

/**
 * Looks up a task by its per-project index.
 *
 * @param args - Project id and per-project task index
 * @param authManager - Active auth manager holding session credentials
 * @returns MCP response containing the resolved task
 */
export async function getTaskByIndex(
  args: GetTaskByIndexArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (args.projectId === undefined || args.projectId === null) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'projectId is required for get-by-index operation',
    );
  }
  if (args.index === undefined || args.index === null) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'index is required for get-by-index operation',
    );
  }
  validateId(args.projectId, 'projectId');
  validateId(args.index, 'index');

  const task = await vikunjaRestRequest<{ id: number; title?: string }>(
    authManager,
    'GET',
    `/projects/${args.projectId}/tasks/by-index/${args.index}`,
  );

  const response = createStandardResponse(
    'get-task-by-index',
    `Resolved task at index ${args.index} in project ${args.projectId}`,
    { task },
    {
      timestamp: new Date().toISOString(),
      projectId: args.projectId,
      index: args.index,
    },
    args.sessionId,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: formatAorpAsMarkdown(response),
      },
    ],
  };
}
