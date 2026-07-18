/**
 * Assignee operations for tasks
 * Refactored to use modular service architecture
 */

import { MCPError, ErrorCode } from '../../../types';
import type { AuthManager } from '../../../auth/AuthManager';
import { createStandardResponse, formatAorpAsMarkdown } from '../../../utils/response-factory';
import { AssigneeOperationsService } from './AssigneeOperationsService';
import { AssigneeValidationService } from './AssigneeValidationService';
import { AssigneeResponseFormatter } from './AssigneeResponseFormatter';

/**
 * Assign users to a task
 */
export async function assignUsers(
  args: {
    id?: number;
    assignees?: number[];
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, assigneeIds } = AssigneeValidationService.validateAssignInput(args);

    // Perform the assignment operation
    await AssigneeOperationsService.assignUsersToTask(authManager, taskId, assigneeIds);

    // Verify the assignees actually persisted (defense-in-depth against silent
    // API failures — adapted from upstream PR #43). Fails open on fetch errors.
    const missingIds = await AssigneeOperationsService.verifyAssignees(taskId, assigneeIds);

    // Fetch updated task data
    const task = await AssigneeOperationsService.fetchTaskWithAssignees(taskId);

    // Format and return response, surfacing a warning if verification failed
    const response = AssigneeResponseFormatter.formatAssignResponse(task);
    if (missingIds.length > 0) {
      response.success = false;
      response.message =
        `Assignee operation reported success, but user(s) [${missingIds.join(', ')}] were not persisted. ` +
        `This is a known Vikunja API limitation with API token auth. Try using JWT authentication instead.`;
    }
    return AssigneeResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to assign users to task: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Unassign users from a task
 */
export async function unassignUsers(
  args: {
    id?: number;
    assignees?: number[];
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, userIds } = AssigneeValidationService.validateUnassignInput(args);

    // Perform the unassignment operation
    await AssigneeOperationsService.removeUsersFromTask(authManager, taskId, userIds);

    // Fetch updated task data
    const task = await AssigneeOperationsService.fetchTaskWithAssignees(taskId);

    // Format and return response
    const response = AssigneeResponseFormatter.formatUnassignResponse(task);
    return AssigneeResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to remove users from task: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * List assignees of a task.
 *
 * Calls the dedicated `GET /tasks/{taskID}/assignees` endpoint directly
 * (not `GET /tasks/{id}` + the embedded `assignees` array, which is what
 * `assignUsers`/`unassignUsers` use internally for verification/refresh) so
 * that the endpoint's documented `s` (username search) and `page`/`per_page`
 * query params are actually reachable — see docs/API-COVERAGE.md's
 * `GET /tasks/{taskID}/assignees` row for the gap this closes.
 */
export async function listAssignees(
  args: {
    id?: number;
    search?: string;
    page?: number;
    perPage?: number;
    sessionId?: string;
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, search, page, perPage } = AssigneeValidationService.validateListInput(args);

    const assignees = await AssigneeOperationsService.fetchAssigneesViaRest(authManager, taskId, {
      ...(search !== undefined && { search }),
      ...(page !== undefined && { page }),
      ...(perPage !== undefined && { perPage }),
    });

    const response = createStandardResponse(
      'get',
      `Task ${taskId} has ${assignees.length} assignee(s)`,
      {
        taskId,
        assignees: assignees.map((a) => ({
          id: a.id ?? null,
          username: a.username ?? null,
          name: a.name ?? null,
          email: a.email ?? null,
        })),
        count: assignees.length,
      },
      {
        timestamp: new Date().toISOString(),
        count: assignees.length,
        ...(search !== undefined && { search }),
        ...(page !== undefined && { page }),
        ...(perPage !== undefined && { perPage }),
      },
      args.sessionId,
    );

    return { content: [{ type: 'text', text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to list task assignees: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}