/**
 * Task Update Service
 * Handles task updates with field diffing and relationship management
 */

import { MCPError, ErrorCode } from '../../../types';
import type { AuthManager } from '../../../auth/AuthManager';
import { vikunjaRestRequest } from '../../../utils/vikunja-rest';
import { getTaskViaRest } from '../../../utils/task-rest-transport';
import { validateDateString, validateId, convertRepeatConfiguration } from '../validation';
import { isAuthenticationError } from '../../../utils/auth-error-handler';
import { RETRY_CONFIG } from '../../../utils/retry';
import { setTaskLabels } from '../../../utils/label-bulk';
import {
  transformApiError,
  handleFetchError,
  handleStatusCodeError,
  wrapIfRestOrigin,
} from '../../../utils/error-handler';
import { extractHttpErrorDetail } from '../../../utils/http-error-detail';
import { AUTH_ERROR_MESSAGES } from '../constants';
import { createTaskResponse } from './TaskResponseFormatter';
import { formatAorpAsMarkdown } from '../../../utils/response-factory';
import type { components } from '../../../types/generated/vikunja-openapi';

/** `models.Task` per the OpenAPI spec — request/response shape for the task endpoints. */
type VikunjaTask = components['schemas']['models.Task'];

export interface UpdateTaskArgs {
  id?: number;
  title?: string;
  description?: string;
  dueDate?: string;
  startDate?: string;
  endDate?: string;
  priority?: number;
  percentDone?: number;
  done?: boolean;
  /** Move the task to another project (merged into full-model update). */
  projectId?: number;
  labels?: number[];
  assignees?: number[];
  repeatAfter?: number;
  repeatMode?: 'day' | 'week' | 'month' | 'year';
  // Session ID for AORP response tracking
  sessionId?: string;
}

/**
 * Internal interface for tracking update state and field changes
 */
interface UpdateState {
  currentTask: VikunjaTask;
  previousState: Record<string, unknown>;
  affectedFields: string[];
}

/**
 * Updates a task with comprehensive field diffing and relationship management
 */
export async function updateTask(
  args: UpdateTaskArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (!args.id) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for update operation');
    }
    validateId(args.id, 'id');

    // Validate dates if provided
    if (args.dueDate) {
      validateDateString(args.dueDate, 'dueDate');
    }
    if (args.startDate) {
      validateDateString(args.startDate, 'startDate');
    }
    if (args.endDate) {
      validateDateString(args.endDate, 'endDate');
    }

    // Validate project move target if provided
    if (args.projectId !== undefined) {
      validateId(args.projectId, 'projectId');
    }

    // Analyze current state and track changes
    const updateState = await analyzeUpdateState(authManager, args.id, args);

    // Build and apply the update (full-model merge — Vikunja replaces the whole task)
    const updateData = buildUpdateData(updateState.currentTask, args);
    await vikunjaRestRequest<VikunjaTask>(authManager, 'POST', `/tasks/${args.id}`, updateData);

    // Update labels if provided
    if (args.labels !== undefined) {
      await updateTaskLabels(authManager, args.id, args.labels);
    }

    // Update assignees if provided
    if (args.assignees !== undefined) {
      await updateTaskAssignees(authManager, args.id, args.assignees);
    }

    // Fetch the complete updated task
    const completeTask = await vikunjaRestRequest<VikunjaTask>(authManager, 'GET', `/tasks/${args.id}`);

    // Verify project move actually stuck — Vikunja can report success while leaving
    // the task in the old project (silent failure → data loss if the old project is deleted)
    if (args.projectId !== undefined && completeTask.project_id !== args.projectId) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `Failed to move task ${args.id} to project ${args.projectId}: ` +
          `task remains in project ${completeTask.project_id ?? 'unknown'}. ` +
          `The move was not applied by Vikunja.`,
      );
    }

    const response = createTaskResponse(
      'update-task',
      'Task updated successfully',
      { task: completeTask } as unknown as Parameters<typeof createTaskResponse>[2],
      {
        timestamp: new Date().toISOString(),
        affectedFields: updateState.affectedFields,
        previousState: updateState.previousState,
        taskId: args.id,
      } as unknown as Parameters<typeof createTaskResponse>[3],
      undefined, // verbosity (ignored - using standard AORP)
      undefined, // useOptimizedFormat (ignored - using standard AORP)
      undefined, // useAorp (ignored - always using AORP)
      undefined, // aorpConfig (using auto-generated)
      args.sessionId
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response.response),
        },
      ],
    };
  } catch (error) {
    // A REST 404 is translated to the same friendly "not found" message the
    // pre-migration legacy client error path produced via handleStatusCodeError
    // (which keys off a bare `.statusCode` property, not the `.details`
    // nesting vikunjaRestRequest's thrown MCPError uses). Any other
    // REST-origin MCPError (label/assignee writes, the task-refresh GET —
    // all now throw MCPError directly via vikunjaRestRequest, unlike the
    // pre-migration legacy client) gets the conventional "Failed to update
    // task: ..." wrapping restored via wrapIfRestOrigin, preserving the
    // original code/details; this tool's own validation/internal MCPErrors
    // (no REST statusCode) still pass through unmodified.
    if (error instanceof MCPError) {
      if (error.details?.statusCode === 404 && args.id) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Task with ID ${args.id} not found`);
      }
      throw wrapIfRestOrigin(error, 'update task');
    }

    // Handle fetch/connection errors with helpful guidance
    if (error instanceof Error && (
      error.message.includes('fetch failed') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    )) {
      throw handleFetchError(error, 'update task');
    }

    // Use standardized error transformation for all other errors
    if (args.id) {
      throw handleStatusCodeError(error, 'update task', args.id, `Task with ID ${args.id} not found`);
    }
    throw transformApiError(error, 'Failed to update task');
  }
}

/**
 * Analyzes the current task state and determines which fields are being updated
 */
async function analyzeUpdateState(
  authManager: AuthManager,
  taskId: number,
  args: UpdateTaskArgs,
): Promise<UpdateState> {
  // Fetch the current task to preserve all fields and track changes
  const currentTask = await vikunjaRestRequest<VikunjaTask>(authManager, 'GET', `/tasks/${taskId}`);
  const previousState: Record<string, unknown> = {};
  if (currentTask.title !== undefined) previousState.title = currentTask.title;
  if (currentTask.description !== undefined) previousState.description = currentTask.description;
  if (currentTask.due_date !== undefined) previousState.due_date = currentTask.due_date;
  if (currentTask.start_date !== undefined) previousState.start_date = currentTask.start_date;
  if (currentTask.end_date !== undefined) previousState.end_date = currentTask.end_date;
  if (currentTask.priority !== undefined) previousState.priority = currentTask.priority;
  if (currentTask.done !== undefined) previousState.done = currentTask.done;
  if (currentTask.percent_done !== undefined) previousState.percent_done = currentTask.percent_done;
  if (currentTask.project_id !== undefined) previousState.project_id = currentTask.project_id;
  if (currentTask.repeat_after !== undefined) previousState.repeat_after = currentTask.repeat_after;
  if (currentTask.repeat_mode !== undefined) previousState.repeat_mode = currentTask.repeat_mode;

  // Track which fields are being updated
  const affectedFields: string[] = [];

  if (args.title !== undefined && args.title !== currentTask.title) affectedFields.push('title');
  if (args.description !== undefined && args.description !== currentTask.description) affectedFields.push('description');
  if (args.dueDate !== undefined && args.dueDate !== currentTask.due_date) affectedFields.push('dueDate');
  if (args.startDate !== undefined && args.startDate !== currentTask.start_date) affectedFields.push('start_date');
  if (args.endDate !== undefined && args.endDate !== currentTask.end_date) affectedFields.push('end_date');
  if (args.priority !== undefined && args.priority !== currentTask.priority) affectedFields.push('priority');
  if (args.percentDone !== undefined && args.percentDone !== currentTask.percent_done) affectedFields.push('percentDone');
  if (args.done !== undefined && args.done !== currentTask.done) affectedFields.push('done');
  if (args.projectId !== undefined && args.projectId !== currentTask.project_id) affectedFields.push('projectId');
  if (args.repeatAfter !== undefined && args.repeatAfter !== currentTask.repeat_after) affectedFields.push('repeatAfter');
  // args.repeatMode is the user-facing string enum ('day'|'week'|...);
  // currentTask.repeat_mode is the API's numeric enum (0|1|2) — these were
  // never the same representation even before this migration (the legacy client's
  // type incorrectly claimed both were the string enum), so this comparison
  // is always true when repeatMode is supplied. Cast preserves that existing
  // runtime behavior while satisfying the now-correctly-typed comparison.
  if (args.repeatMode !== undefined && (args.repeatMode as unknown) !== currentTask.repeat_mode) affectedFields.push('repeatMode');
  if (args.labels !== undefined) affectedFields.push('labels');
  if (args.assignees !== undefined) affectedFields.push('assignees');

  return {
    currentTask,
    previousState,
    affectedFields
  };
}

/**
 * Builds the update data object by merging current task data with updates
 * This prevents the API from clearing fields that aren't explicitly updated
 */
function buildUpdateData(currentTask: VikunjaTask, args: UpdateTaskArgs): VikunjaTask {
  const updateData: VikunjaTask = {
    ...currentTask,
    // Override with any provided updates
    ...(args.title !== undefined && { title: args.title }),
    ...(args.description !== undefined && { description: args.description }),
    ...(args.dueDate !== undefined && { due_date: args.dueDate }),
    ...(args.startDate !== undefined && { start_date: args.startDate }),
    ...(args.endDate !== undefined && { end_date: args.endDate }),
    ...(args.priority !== undefined && { priority: args.priority }),
    ...(args.percentDone !== undefined && { percent_done: args.percentDone }),
    ...(args.done !== undefined && { done: args.done }),
    // Move between projects — must be part of the full-model payload or Vikunja ignores it
    ...(args.projectId !== undefined && { project_id: args.projectId }),
    // Handle repeat configuration for updates. The generated
    // `models.Task.repeat_mode` type (0 | 1 | 2) matches the real API, so no
    // bypass cast is needed here (unlike the legacy client's incorrect string enum).
    ...(args.repeatAfter !== undefined || args.repeatMode !== undefined
      ? ((): Partial<VikunjaTask> => {
          const repeatConfig = convertRepeatConfiguration(
            args.repeatAfter !== undefined ? args.repeatAfter : currentTask.repeat_after,
            args.repeatMode !== undefined ? args.repeatMode : undefined,
          );
          const updates: Partial<VikunjaTask> = {};
          if (repeatConfig.repeat_after !== undefined)
            updates.repeat_after = repeatConfig.repeat_after;
          if (repeatConfig.repeat_mode !== undefined)
            updates.repeat_mode = repeatConfig.repeat_mode as 0 | 1 | 2;
          return updates;
        })()
      : {}),
  };

  return updateData;
}

/**
 * Updates task labels with authentication error handling.
 *
 * The catch surfaces the HTTP status + body of the underlying Vikunja error
 * in both branches. Previously the catch replaced any 403/422 from
 * `POST /tasks/{id}/labels/bulk` with the generic LABEL_UPDATE "known
 * limitation" message, which hid the real cause (e.g. a permission failure
 * vs an invalid label id) from the MCP client and made the diagnostic
 * round-trip much longer for the consumer.
 */
async function updateTaskLabels(authManager: AuthManager, taskId: number, labelIds: number[]): Promise<void> {
  try {
    await setTaskLabels(authManager, taskId, labelIds);
  } catch (labelError) {
    const detail = extractHttpErrorDetail(labelError);
    if (isAuthenticationError(labelError)) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        detail
          ? `${AUTH_ERROR_MESSAGES.LABEL_UPDATE} ${detail}`
          : AUTH_ERROR_MESSAGES.LABEL_UPDATE,
      );
    }
    if (detail) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `Failed to update task labels ${detail}`,
      );
    }
    throw labelError;
  }
}

/**
 * Updates task assignees with diff calculation and authentication error
 * handling, via the direct-REST assignee endpoints.
 */
async function updateTaskAssignees(authManager: AuthManager, taskId: number, newAssigneeIds: number[]): Promise<void> {
  try {
    // Get current assignees to calculate diff
    const currentTask = await getTaskViaRest(authManager, taskId);
    const currentAssigneeIds = (currentTask.assignees ?? [])
      .map((a) => a.id)
      .filter((id): id is number => typeof id === 'number');

    // Calculate which assignees to add and remove
    const toAdd = newAssigneeIds.filter((id: number) => !currentAssigneeIds.includes(id));
    const toRemove = currentAssigneeIds.filter((id: number) => !newAssigneeIds.includes(id));

    // Add new assignees first to avoid leaving task unassigned if removal fails.
    // Use the ADDITIVE single-assign endpoint per user (PUT
    // /tasks/{taskID}/assignees, body { user_id }, models.TaskAssginee) rather
    // than the bulk endpoint (POST .../assignees/bulk), which REPLACES the
    // whole list and would silently unassign everyone (upstream issue #15).
    // Mirrors the per-user removal loop directly below.
    if (toAdd.length > 0) {
      await Promise.all(
        toAdd.map((userId: number) =>
          vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, { user_id: userId }),
        )
      );
    }

    // Remove old assignees only after new ones are successfully added. DELETE
    // /tasks/{taskID}/assignees/{userID} per the OpenAPI spec — no body.
    for (const userId of toRemove) {
      try {
        await vikunjaRestRequest(authManager, 'DELETE', `/tasks/${taskId}/assignees/${userId}`);
      } catch (removeError) {
        // Check if it's an auth error on remove
        if (isAuthenticationError(removeError)) {
          throw new MCPError(ErrorCode.API_ERROR, AUTH_ERROR_MESSAGES.ASSIGNEE_REMOVE_PARTIAL);
        }
        throw removeError;
      }
    }
  } catch (assigneeError) {
    // Check if it's an auth error after retries
    if (isAuthenticationError(assigneeError)) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `${AUTH_ERROR_MESSAGES.ASSIGNEE_UPDATE} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times)`
      );
    }
    throw assigneeError;
  }
}
