/**
 * Assignee operations service
 * Handles core business logic for task assignee management
 */

import type { TaskWithAssignees, Assignee } from '../../../types';
import { MCPError, ErrorCode } from '../../../types';
import { getClientFromContext } from '../../../client';
import type { AuthManager } from '../../../auth/AuthManager';
import { isAuthenticationError } from '../../../utils/auth-error-handler';
import { withRetry, RETRY_CONFIG } from '../../../utils/retry';
import { vikunjaRestRequest } from '../../../utils/vikunja-rest';
import { validateId } from '../../../utils/validation';
import { AUTH_ERROR_MESSAGES } from '../constants';
import type { components } from '../../../types/generated/vikunja-openapi';

/**
 * `user.User` shape as returned by `GET /tasks/{taskID}/assignees` per the
 * OpenAPI spec's `models.User` -> `user.User` schema.
 */
export type VikunjaAssigneeUser = components['schemas']['user.User'];

/** Query params accepted by `GET /tasks/{taskID}/assignees` (page/per_page/s). */
export interface ListAssigneesRestParams {
  page?: number;
  perPage?: number;
  search?: string;
}

/**
 * Service for managing task assignee operations
 */
export const AssigneeOperationsService = {
  /**
   * Assign multiple users to a task
   */
  async assignUsersToTask(
    authManager: AuthManager,
    taskId: number,
    assigneeIds: number[],
  ): Promise<void> {
    try {
      // Assign users one-by-one via the ADDITIVE single-assign endpoint
      // (PUT /tasks/{taskID}/assignees, body { user_id }, per the OpenAPI
      // spec's models.TaskAssginee). We deliberately avoid the bulk endpoint
      // (POST /tasks/{taskID}/assignees/bulk, models.BulkAssignees): it
      // REPLACES the whole assignee list rather than adding to it, so a bulk
      // call would silently unassign everyone instead of adding users
      // (upstream issue #15). The per-user PUT matches Vikunja's real
      // additive single-assign model. Calls run concurrently via
      // Promise.all.
      await Promise.all(
        assigneeIds.map((userId) =>
          withRetry(
            () =>
              vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, {
                user_id: userId,
              }),
            {
              ...RETRY_CONFIG.AUTH_ERRORS,
              shouldRetry: (error) => isAuthenticationError(error)
            }
          )
        )
      );
    } catch (assigneeError) {
      // Check if it's an auth error after retries
      if (isAuthenticationError(assigneeError)) {
        throw new MCPError(
          ErrorCode.API_ERROR,
          `${AUTH_ERROR_MESSAGES.ASSIGNEE_ASSIGN} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times)`
        );
      }
      throw assigneeError;
    }
  },

  /**
   * Remove multiple users from a task
   */
  async removeUsersFromTask(
    authManager: AuthManager,
    taskId: number,
    userIds: number[],
  ): Promise<void> {
    // Remove users from the task with retry logic. DELETE
    // /tasks/{taskID}/assignees/{userID} per the OpenAPI spec — no body.
    for (const userId of userIds) {
      try {
        await withRetry(
          () => vikunjaRestRequest(authManager, 'DELETE', `/tasks/${taskId}/assignees/${userId}`),
          {
            ...RETRY_CONFIG.AUTH_ERRORS,
            shouldRetry: (error) => isAuthenticationError(error)
          }
        );
      } catch (removeError) {
        // Check if it's an auth error after retries
        if (isAuthenticationError(removeError)) {
          throw new MCPError(
            ErrorCode.API_ERROR,
            `${AUTH_ERROR_MESSAGES.ASSIGNEE_REMOVE} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times)`
          );
        }
        throw removeError;
      }
    }
  },

  /**
   * Fetch task data to get current assignees
   */
  async fetchTaskWithAssignees(taskId: number): Promise<TaskWithAssignees> {
    const client = await getClientFromContext();
    const task = await client.tasks.getTask(taskId);
    // Ensure required properties exist for TaskWithAssignees
    if (!task.id) {
      throw new MCPError(ErrorCode.INTERNAL_ERROR, 'Task returned from API is missing required id field');
    }
    return {
      ...task,
      id: task.id,
      title: task.title || '',
      assignees: task.assignees || [],
    };
  },

  /**
   * Extract assignee information from task
   */
  extractAssignees(task: TaskWithAssignees): Assignee[] {
    return task.assignees || [];
  },

  /**
   * Fetch a task's assignees via the dedicated endpoint
   * (`GET /tasks/{taskID}/assignees`), rather than reading the `assignees`
   * array embedded in `GET /tasks/{id}` (what `fetchTaskWithAssignees`
   * above does). This is the only way to reach the endpoint's documented
   * `page`/`per_page`/`s` (username search) query params — the embedded
   * array on the task object has no pagination or search of its own.
   */
  async fetchAssigneesViaRest(
    authManager: AuthManager,
    taskId: number,
    params: ListAssigneesRestParams = {},
  ): Promise<VikunjaAssigneeUser[]> {
    if (params.page !== undefined) validateId(params.page, 'page');
    if (params.perPage !== undefined) validateId(params.perPage, 'perPage');

    const query = new URLSearchParams();
    if (params.search) query.set('s', params.search);
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.perPage !== undefined) query.set('per_page', String(params.perPage));
    const qs = query.toString();

    const result = await vikunjaRestRequest<VikunjaAssigneeUser[]>(
      authManager,
      'GET',
      `/tasks/${taskId}/assignees${qs ? `?${qs}` : ''}`,
    );
    return Array.isArray(result) ? result : [];
  },

  /**
   * Verify that requested assignees were actually persisted by re-fetching the task.
   * Returns the IDs that were requested but are missing from the task.
   *
   * Defense-in-depth safety net (adapted from upstream PR #43 by @AriahPerson)
   * layered on top of the per-user assign fix: even with the correct additive
   * endpoint, certain Vikunja API/auth combinations can report success without
   * persisting assignees. Re-checking the persisted list surfaces that silent
   * failure to the caller.
   *
   * Fails open: if the verification re-fetch itself errors we return [] (assume
   * OK) so a transient read failure never blocks the assign operation.
   */
  async verifyAssignees(taskId: number, requestedIds: number[]): Promise<number[]> {
    if (requestedIds.length === 0) {
      return [];
    }
    try {
      const task = await AssigneeOperationsService.fetchTaskWithAssignees(taskId);
      const persistedIds = new Set(
        AssigneeOperationsService.extractAssignees(task).map((a: Assignee) => a.id)
      );
      return requestedIds.filter((id) => !persistedIds.has(id));
    } catch {
      // If we can't verify, don't block — assume the assignment is fine.
      return [];
    }
  }
};