/**
 * Assignee operations service
 * Handles core business logic for task assignee management
 */

import type { TaskWithAssignees, Assignee } from '../../../types';
import { MCPError, ErrorCode } from '../../../types';
import type { AuthManager } from '../../../auth/AuthManager';
import { extractHttpStatus } from '../../../utils/http-error-detail';
import { withRetry, RETRY_CONFIG } from '../../../utils/retry';
import { vikunjaRestRequest } from '../../../utils/vikunja-rest';
import { getTaskViaRest } from '../../../utils/task-rest-transport';
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
      // (democratize-technology/vikunja-mcp#15). The per-user PUT matches
      // Vikunja's real additive single-assign model. Sequential on purpose
      // (post-#89 pattern sweep, mirrors removeUsersFromTask below):
      // concurrent per-user writes to the same task risk "database is
      // locked" 500s on SQLite-backed instances.
      for (const userId of assigneeIds) {
        await withRetry(
          () =>
            vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, {
              user_id: userId,
            }),
          {
            ...RETRY_CONFIG.AUTH_ERRORS,
            // Only a genuine 401 session failure is worth retrying here; a
            // resource 403 (e.g. no write access) must not be masked as auth
            // and retried — that was bug #154 in the labels tool. The inner
            // vikunjaRestRequest already retries 5xx/429 on its own.
            shouldRetry: (error) => extractHttpStatus(error) === 401
          }
        );
      }
    } catch (assigneeError) {
      // A genuine session failure after retries — surface it as auth.
      if (extractHttpStatus(assigneeError) === 401) {
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
    // Remove each user. DELETE /tasks/{taskID}/assignees/{userID} — no body.
    // Like the label DELETE in bug #154, a failed DELETE does NOT by itself
    // mean an error: the v1 spec documents 403 for this endpoint (never 404),
    // returned when the user is not assigned; v2 collapses errors into a
    // generic response and may even make the delete idempotent (204). Rather
    // than depend on any one status, we special-case ONLY a genuine 401 as
    // auth (the inner vikunjaRestRequest already retries 5xx/429) and reconcile
    // every other failure against the task's real assignee list below — so an
    // already-absent user is an idempotent no-op on both v1 and v2.
    const removeFailures: number[] = [];
    for (const userId of userIds) {
      try {
        await withRetry(
          () => vikunjaRestRequest(authManager, 'DELETE', `/tasks/${taskId}/assignees/${userId}`),
          {
            ...RETRY_CONFIG.AUTH_ERRORS,
            shouldRetry: (error) => extractHttpStatus(error) === 401
          }
        );
      } catch (removeError) {
        // A genuine session failure can't be masked as an absent assignee.
        if (extractHttpStatus(removeError) === 401) {
          throw new MCPError(
            ErrorCode.API_ERROR,
            `${AUTH_ERROR_MESSAGES.ASSIGNEE_REMOVE} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times)`
          );
        }
        // Non-auth failure (typically Vikunja's 403 for a user not assigned).
        // Defer judgement to the actual assignee list below.
        removeFailures.push(userId);
      }
    }

    if (removeFailures.length === 0) {
      return;
    }

    // Reconcile against ground truth: the users actually assigned now, read
    // from the dedicated GET /tasks/{taskID}/assignees endpoint.
    let stillAssigned: number[];
    try {
      const current = await AssigneeOperationsService.fetchAssigneesViaRest(authManager, taskId);
      const currentIds = new Set(
        current.map((u) => u.id).filter((id): id is number => typeof id === 'number'),
      );
      stillAssigned = removeFailures.filter((id) => currentIds.has(id));
    } catch {
      // Current assignees could not be read; treat the failed removals as
      // genuine failures rather than assuming they succeeded.
      stillAssigned = removeFailures;
    }

    if (stillAssigned.length > 0) {
      const plural = stillAssigned.length > 1;
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        `Could not remove user${plural ? 's' : ''} ${stillAssigned.join(', ')} from task ${taskId}: ` +
          `still assigned after the request. Check the user id${plural ? 's' : ''} and that you have write access to the task.`,
      );
    }
    // Otherwise every failed removal was for a user already not assigned —
    // an idempotent no-op, so the unassign succeeds.
  },

  /**
   * Fetch task data to get current assignees via GET /tasks/{id} (direct-REST)
   */
  async fetchTaskWithAssignees(
    authManager: AuthManager,
    taskId: number,
  ): Promise<TaskWithAssignees> {
    const task = await getTaskViaRest(authManager, taskId);
    // Ensure required properties exist for TaskWithAssignees
    if (!task.id) {
      throw new MCPError(ErrorCode.INTERNAL_ERROR, 'Task returned from API is missing required id field');
    }
    return {
      ...task,
      id: task.id,
      title: task.title || '',
      // `models.Task.assignees` is `user.User[]` (all fields optional per Go
      // `omitempty`); `Assignee` requires `id`/`username`. A persisted
      // assignee always carries both, so this narrows the spec-optional shape
      // to the response type the formatters consume.
      assignees: (task.assignees ?? []) as Assignee[],
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
  async verifyAssignees(
    authManager: AuthManager,
    taskId: number,
    requestedIds: number[],
  ): Promise<number[]> {
    if (requestedIds.length === 0) {
      return [];
    }
    try {
      const task = await AssigneeOperationsService.fetchTaskWithAssignees(authManager, taskId);
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