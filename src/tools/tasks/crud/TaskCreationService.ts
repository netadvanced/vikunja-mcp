/**
 * Task Creation Service
 * Handles task creation with label/assignee management and rollback logic
 */

import { MCPError, ErrorCode } from '../../../types';
import { getClientFromContext } from '../../../client';
import type { VikunjaClient } from 'node-vikunja';
import type { AuthManager } from '../../../auth/AuthManager';
import { vikunjaRestRequest } from '../../../utils/vikunja-rest';
import { logger } from '../../../utils/logger';
import { isAuthenticationError } from '../../../utils/auth-error-handler';
import { withRetry, RETRY_CONFIG } from '../../../utils/retry';
import { transformApiError, handleFetchError } from '../../../utils/error-handler';
import { sanitizeString } from '../../../utils/validation';
import { AUTH_ERROR_MESSAGES } from '../constants';
import { validateDateString, validateId, convertRepeatConfiguration } from '../validation';
import { createTaskResponse } from './TaskResponseFormatter';
import { formatAorpAsMarkdown } from '../../../utils/response-factory';
import type { components } from '../../../types/generated/vikunja-openapi';

/** `models.Task` per the OpenAPI spec — request/response shape for the task endpoints. */
type VikunjaTask = components['schemas']['models.Task'];

export interface CreateTaskArgs {
  projectId?: number;
  title?: string;
  description?: string;
  dueDate?: string;
  startDate?: string;
  endDate?: string;
  priority?: number;
  labels?: number[];
  assignees?: number[];
  repeatAfter?: number;
  repeatMode?: 'day' | 'week' | 'month' | 'year';
  // Session ID for AORP response tracking
  sessionId?: string;
}

/**
 * Internal interface for tracking creation state during rollback scenarios
 */
interface CreationState {
  createdTask: VikunjaTask;
  labelsAdded: boolean;
  assigneesAdded: boolean;
}

/**
 * Creates a new task with comprehensive error handling and rollback support
 */
export async function createTask(
  args: CreateTaskArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Validate required fields
    if (!args.projectId) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'projectId is required to create a task');
    }
    validateId(args.projectId, 'projectId');

    if (!args.title) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'title is required to create a task');
    }

    // Sanitize and validate user inputs for comprehensive security
    const sanitizedTitle = sanitizeString(args.title);
    // Preserve empty strings as they are valid descriptions
    const sanitizedDescription = args.description !== undefined ? sanitizeString(args.description) : undefined;

    // Validate optional date fields
    if (args.dueDate) {
      validateDateString(args.dueDate, 'dueDate');
    }
    if (args.startDate) {
      validateDateString(args.startDate, 'startDate');
    }
    if (args.endDate) {
      validateDateString(args.endDate, 'endDate');
    }

    // Validate assignee IDs upfront
    if (args.assignees && args.assignees.length > 0) {
      args.assignees.forEach((id) => validateId(id, 'assignee ID'));
    }

    // Validate label IDs upfront
    if (args.labels && args.labels.length > 0) {
      args.labels.forEach((id) => validateId(id, 'label ID'));
    }

    // Build the initial task object with sanitized values
    const newTask: VikunjaTask = {
      title: sanitizedTitle,
      project_id: args.projectId,
    };

    // Add optional fields with sanitized values
    if (sanitizedDescription !== undefined) newTask.description = sanitizedDescription;
    if (args.dueDate !== undefined) newTask.due_date = args.dueDate;
    if (args.startDate !== undefined) newTask.start_date = args.startDate;
    if (args.endDate !== undefined) newTask.end_date = args.endDate;
    if (args.priority !== undefined) newTask.priority = args.priority;

    // Handle repeat configuration. The generated `models.Task.repeat_mode`
    // type (0 | 1 | 2) matches the real API, unlike node-vikunja's
    // (incorrect) 'day' | 'week' | 'month' | 'year' typing — no bypass cast
    // needed now that this goes through the generated type.
    if (args.repeatAfter !== undefined || args.repeatMode !== undefined) {
      const repeatConfig = convertRepeatConfiguration(args.repeatAfter, args.repeatMode);
      if (repeatConfig.repeat_after !== undefined) newTask.repeat_after = repeatConfig.repeat_after;
      if (repeatConfig.repeat_mode !== undefined) {
        newTask.repeat_mode = repeatConfig.repeat_mode as 0 | 1 | 2;
      }
    }

    // Create the base task. PUT /projects/{id}/tasks per the OpenAPI spec
    // (models.Task request/response body).
    const createdTask = await vikunjaRestRequest<VikunjaTask>(
      authManager,
      'PUT',
      `/projects/${args.projectId}/tasks`,
      newTask,
    );

    // Labels/assignees require a task id — fail loudly instead of reporting success without them
    const needsPostCreate =
      (args.labels !== undefined && args.labels.length > 0) ||
      (args.assignees !== undefined && args.assignees.length > 0);
    if (needsPostCreate && !createdTask.id) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        'Task was created but Vikunja did not return a task id, so labels/assignees could not be applied',
      );
    }

    // Track creation state for potential rollback
    const creationState: CreationState = {
      createdTask,
      labelsAdded: false,
      assigneesAdded: false
    };

    if (needsPostCreate) {
      // Labels/assignees are a task sub-resource migrated by a sibling item
      // (M-B) — still applied via the node-vikunja client here, fetched
      // lazily and only when actually needed.
      const client = await getClientFromContext();

      try {
        // Add labels if provided
        if (args.labels && args.labels.length > 0 && createdTask.id) {
          await addLabelsToTask(client, createdTask.id, args.labels);
          creationState.labelsAdded = true;
        }

        // Add assignees if provided
        if (args.assignees && args.assignees.length > 0 && createdTask.id) {
          await addAssigneesToTask(client, createdTask.id, args.assignees);
          creationState.assigneesAdded = true;
        }

      } catch (updateError) {
        // Attempt to clean up the partially created task
        await rollbackTaskCreation(authManager, creationState, updateError);
        // The rollback function will re-throw the original error with context
      }
    }

    // Fetch the complete task with labels and assignees
    const completeTask = createdTask.id
      ? await vikunjaRestRequest<VikunjaTask>(authManager, 'GET', `/tasks/${createdTask.id}`)
      : createdTask;

    // Defense-in-depth (adapted from upstream PR #43): verify assignees actually
    // persisted. Even with the additive per-user endpoint, some Vikunja API/auth
    // combinations can report success without persisting — surface that instead
    // of silently reporting success.
    let assigneeWarning: string | undefined;
    if (args.assignees && args.assignees.length > 0 && completeTask.id) {
      const persistedIds = new Set((completeTask.assignees || []).map((a) => a.id));
      const missingIds = args.assignees.filter((id) => !persistedIds.has(id));
      if (missingIds.length > 0) {
        assigneeWarning =
          `Warning: assignee(s) [${missingIds.join(', ')}] were not persisted. ` +
          `This is a known Vikunja API limitation with API token auth. Try using JWT authentication instead.`;
      }
    }

    // Verify labels actually stuck — avoid silent success when the API no-ops
    if (args.labels && args.labels.length > 0) {
      const attachedIds = new Set(
        (completeTask.labels || [])
          .map((label) => label.id)
          .filter((id): id is number => typeof id === 'number'),
      );
      const missing = args.labels.filter((id) => !attachedIds.has(id));
      if (missing.length > 0) {
        await rollbackTaskCreation(
          authManager,
          creationState,
          new Error(
            `Labels were requested but not attached after create (missing label ids: ${missing.join(', ')})`,
          ),
        );
      }
    }

    const response = createTaskResponse(
      'create-task',
      assigneeWarning
        ? `Task created, but assignees may not have been saved. ${assigneeWarning}`
        : 'Task created successfully',
      { task: completeTask } as unknown as Parameters<typeof createTaskResponse>[2],
      {
        timestamp: new Date().toISOString(),
        projectId: args.projectId,
        // Reflect what was actually persisted, not merely what was requested:
        // if label/assignee attachment fails the task creation is rolled back
        // and this response is never reached, so these flags are only true
        // once the corresponding step has genuinely succeeded.
        labelsAdded: creationState.labelsAdded,
        assigneesAdded: creationState.assigneesAdded,
      },
      undefined, // verbosity (ignored - using standard AORP)
      undefined, // useOptimizedFormat (ignored - using standard AORP)
      undefined, // useAorp (ignored - always using AORP)
      undefined, // aorpConfig (using auto-generated)
      args.sessionId
    );

    logger.debug('Tasks tool response', {
      subcommand: 'create',
      taskId: completeTask.id,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response.response),
        },
      ],
    };
  } catch (error) {
    // Re-throw MCPError instances without modification
    if (error instanceof MCPError) {
      throw error;
    }

    // Handle fetch/connection errors with helpful guidance
    if (error instanceof Error && (
      error.message.includes('fetch failed') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    )) {
      throw handleFetchError(error, 'create task');
    }

    // Use standardized error transformation for all other errors
    throw transformApiError(error, 'Failed to create task');
  }
}

/**
 * Adds labels to a task.
 * Uses addLabelToTask (same as apply-label) — updateTaskLabels can silently
 * no-op on some Vikunja versions (GitHub #37).
 *
 * Labels are a task sub-resource (sibling item M-B); this still goes through
 * the node-vikunja client rather than the direct-REST helper.
 *
 * Intentionally does not use withRetry: that helper shares an "anonymous"
 * circuit breaker across calls, so a later create would re-fire the first
 * call's label set against the wrong task.
 */
async function addLabelsToTask(client: VikunjaClient, taskId: number, labelIds: number[]): Promise<void> {
  try {
    for (const labelId of labelIds) {
      await client.tasks.addLabelToTask(taskId, {
        task_id: taskId,
        label_id: labelId,
      });
    }
  } catch (labelError) {
    // Check if it's an auth error
    if (isAuthenticationError(labelError)) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `${AUTH_ERROR_MESSAGES.LABEL_CREATE} Task ID: ${taskId}`,
      );
    }
    throw labelError;
  }
}

/**
 * Adds assignees to a task with retry logic for authentication errors.
 * Assignees are a task sub-resource (sibling item M-B); this still goes
 * through the node-vikunja client rather than the direct-REST helper.
 */
async function addAssigneesToTask(client: VikunjaClient, taskId: number, assigneeIds: number[]): Promise<void> {
  try {
    // Assign each user via the ADDITIVE single-assign endpoint rather than the
    // bulk endpoint. node-vikunja's bulkAssignUsersToTask posts `{ user_ids }`
    // to Vikunja's bulk endpoint, which expects `{ assignees }` and REPLACES
    // the entire assignee list — the mismatched field is parsed as "assign
    // nobody", silently unassigning everyone (upstream issue #15). Per-user
    // calls run concurrently via Promise.all.
    await Promise.all(
      assigneeIds.map((userId) =>
        withRetry(
          () => client.tasks.assignUserToTask(taskId, userId),
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
        `${AUTH_ERROR_MESSAGES.ASSIGNEE_CREATE} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times). Task ID: ${taskId}`,
      );
    }
    throw assigneeError;
  }
}

/**
 * Attempts to roll back a partially created task and throws enhanced error context
 */
async function rollbackTaskCreation(
  authManager: AuthManager,
  creationState: CreationState,
  originalError: unknown
): Promise<never> {
  // Attempt to clean up the partially created task
  let rollbackSucceeded = false;
  if (creationState.createdTask.id) {
    try {
      await vikunjaRestRequest(authManager, 'DELETE', `/tasks/${creationState.createdTask.id}`);
      rollbackSucceeded = true;
    } catch (deleteError) {
      // Log the cleanup failure but throw the original error
      logger.error('Failed to clean up partially created task:', deleteError);
    }
  }

  // Re-throw the original error with context
  const errorMessage = `Failed to complete task creation: ${originalError instanceof Error ? originalError.message : String(originalError)}. ${
    rollbackSucceeded
      ? 'Task was successfully rolled back.'
      : 'Task rollback also failed - manual cleanup may be required.'
  }`;

  throw new MCPError(ErrorCode.API_ERROR, errorMessage, {
    vikunjaError: {
      taskId: creationState.createdTask.id,
      partiallyCreated: true,
      labelsAdded: creationState.labelsAdded,
      assigneesAdded: creationState.assigneesAdded,
      rollbackSucceeded,
    },
  });
}
