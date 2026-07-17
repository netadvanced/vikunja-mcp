/**
 * Task position operations
 *
 * Implements `set-position`, which updates a task's ordering within a
 * project view (`POST /tasks/{id}/position`, `models.TaskPosition`). This
 * is the operation behind "move this task above/below that one" or "put
 * this task first in the list view" — Vikunja stores task order per-view,
 * as a float64 `position` value (see `models.TaskPosition`'s doc comment in
 * docs/vikunja-openapi.json for the recommended
 * `(neighbourA.position - neighbourB.position) / 2` midpoint technique for
 * inserting between two existing positions).
 *
 * node-vikunja does not expose this endpoint, so this calls the Vikunja
 * REST API directly via the shared `vikunja-rest` helper.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest, resolveViewIdByKind } from '../../utils/vikunja-rest';

export interface SetTaskPositionArgs {
  /** Id of the task to reposition. */
  id?: number;
  /** New position value (float64 — see the module doc comment). */
  position?: number;
  /** Optional project view id. Auto-resolved from the project + viewKind when omitted. */
  projectViewId?: number;
  /** Optional project id. Auto-resolved from the task when omitted. */
  projectId?: number;
  /**
   * Kind of view to resolve `projectViewId` against when it is omitted.
   * Defaults to `list`, since task position ordering is most commonly a
   * list-view concept (Kanban ordering is handled by `set-bucket`).
   */
  viewKind?: 'list' | 'gantt' | 'table' | 'kanban';
  /** Session id for response tracking. */
  sessionId?: string;
}

interface VikunjaTaskSummary {
  id: number;
  project_id: number;
  title?: string;
}

/**
 * Updates a task's position within a project view.
 *
 * Resolution order when optional ids are omitted:
 *  - projectId: fetched from the task itself
 *  - projectViewId: resolved to the project's first view of `viewKind`
 *    (default `list`)
 *
 * @param args - Task id, new position, and optional view/project ids
 * @param authManager - Active auth manager holding session credentials
 * @returns MCP response describing the reposition
 */
export async function setTaskPosition(
  args: SetTaskPositionArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for set-position operation');
  }
  if (args.position === undefined || args.position === null) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'position is required for set-position operation',
    );
  }
  validateId(args.id, 'id');
  if (args.projectViewId !== undefined) validateId(args.projectViewId, 'projectViewId');
  if (args.projectId !== undefined) validateId(args.projectId, 'projectId');

  // Resolve the project id from the task when the caller did not supply it.
  let projectId = args.projectId;
  if (projectId === undefined) {
    const task = await vikunjaRestRequest<VikunjaTaskSummary>(
      authManager,
      'GET',
      `/tasks/${args.id}`,
    );
    if (!task || typeof task.project_id !== 'number') {
      throw new MCPError(
        ErrorCode.NOT_FOUND,
        `Could not resolve the project of task ${args.id}`,
      );
    }
    projectId = task.project_id;
  }

  // Resolve the project view id when the caller did not supply it.
  const viewKind = args.viewKind ?? 'list';
  const projectViewId =
    args.projectViewId !== undefined
      ? args.projectViewId
      : (await resolveViewIdByKind(authManager, projectId, viewKind)).id;

  // Update the position. Vikunja's endpoint takes the full TaskPosition
  // model; task_id is also part of the URL but is sent in the body too, as
  // the API model documents it as a body field.
  await vikunjaRestRequest(
    authManager,
    'POST',
    `/tasks/${args.id}/position`,
    { task_id: args.id, project_view_id: projectViewId, position: args.position },
  );

  const response = createStandardResponse(
    'set-task-position',
    `Task ${args.id} repositioned to ${args.position} in view ${projectViewId}`,
    {
      taskId: args.id,
      position: args.position,
      projectViewId,
      projectId,
    },
    {
      timestamp: new Date().toISOString(),
      affectedFields: ['position'],
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
