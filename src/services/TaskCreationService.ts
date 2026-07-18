import { logger } from '../utils/logger';
import type { TaskCreationData } from '../types';
import { MCPError, ErrorCode } from '../types';
import { isAuthenticationError } from '../utils/auth-error-handler';
import { setTaskLabels } from '../utils/label-bulk';
import type { ImportedTask } from '../parsers/InputParserFactory';
import type { EntityResolutionResult } from './EntityResolver';
import type { AuthManager } from '../auth/AuthManager';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { getTaskViaRest } from '../utils/task-rest-transport';
import type { components } from '../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json).
type VikunjaTask = components['schemas']['models.Task'];
/** `user.User` per the OpenAPI spec — resolved project users for assignment. */
type VikunjaUser = components['schemas']['user.User'];

/**
 * Request-body shape for `PUT /projects/{id}/tasks` as this batch-import path
 * builds it. Deliberately a local interface, NOT the generated `models.Task`:
 * this path carries `repeat_mode` as Vikunja's string enum
 * (`'day'|'week'|'month'|'year'`), whereas `models.Task` types `repeat_mode`
 * as the numeric `0|1|2`. Retyping to the generated shape would change the
 * wire payload; this migration is transport-only and must preserve the
 * existing (string) body the legacy-client-backed path sent.
 */
interface TaskCreateRequest {
  title: string;
  project_id: number;
  done?: boolean;
  priority?: number;
  percent_done?: number;
  description?: string;
  due_date?: string;
  start_date?: string;
  end_date?: string;
  hex_color?: string;
  repeat_after?: number;
  repeat_mode?: 'day' | 'week' | 'month' | 'year';
}

/**
 * Converts TaskCreationData to the request body Vikunja expects for task
 * creation, mapping fields and handling optional properties.
 */
function convertTaskCreationDataToTask(taskData: TaskCreationData): TaskCreateRequest {
  const convertedTask: TaskCreateRequest = {
    title: taskData.title,
    project_id: taskData.project_id,
  };

  // Only include optional fields if they are provided (undefined values are excluded)
  if (taskData.done !== undefined) {
    convertedTask.done = taskData.done;
  }
  if (taskData.priority !== undefined) {
    convertedTask.priority = taskData.priority;
  }
  if (taskData.percent_done !== undefined) {
    convertedTask.percent_done = taskData.percent_done;
  }
  if (taskData.description !== undefined) {
    convertedTask.description = taskData.description;
  }
  if (taskData.due_date !== undefined) {
    convertedTask.due_date = taskData.due_date;
  }
  if (taskData.start_date !== undefined) {
    convertedTask.start_date = taskData.start_date;
  }
  if (taskData.end_date !== undefined) {
    convertedTask.end_date = taskData.end_date;
  }
  if (taskData.hex_color !== undefined) {
    convertedTask.hex_color = taskData.hex_color;
  }
  if (taskData.repeat_after !== undefined) {
    convertedTask.repeat_after = taskData.repeat_after;
  }
  if (taskData.repeat_mode !== undefined) {
    // Only assign if it's a valid repeat_mode value
    const validMode = taskData.repeat_mode;
    if (['day', 'week', 'month', 'year'].includes(validMode)) {
      convertedTask.repeat_mode = validMode as 'day' | 'week' | 'month' | 'year';
    }
  }

  return convertedTask;
}

/**
 * Result of a task creation operation
 */
export interface TaskCreationResult {
  success: boolean;
  taskId?: number;
  title: string;
  error?: string;
  warnings?: string[];
}

/**
 * Service responsible for creating individual tasks with all associated entities
 * Handles complex API interactions, error handling, and field transformations
 */
export class TaskCreationService {
  /**
   * Creates a single task with all associated labels, assignees, and other properties
   *
   * @param task - The task data to create
   * @param projectId - The project ID to create the task in
   * @param authManager - Active auth manager holding the session credentials,
   *   used for every direct-REST call this service makes
   * @param entityMaps - Resolved entity mappings for labels and users
   * @param catchErrors - Whether to catch errors and return them in TaskCreationResult (default: true)
   * @returns Promise<TaskCreationResult> - Result of the task creation operation
   */
  async createTask(
    task: ImportedTask,
    projectId: number,
    authManager: AuthManager,
    entityMaps: EntityResolutionResult,
    catchErrors: boolean = true
  ): Promise<TaskCreationResult> {
    const warnings: string[] = [];

    try {
      const taskData = this.prepareTaskData(task, projectId);

      const createdTask = await this.createBaseTask(authManager, taskData, task.title);

      const labelWarnings = await this.handleLabelAssignment(
        authManager,
        createdTask,
        task,
        entityMaps.labelMap
      );
      warnings.push(...labelWarnings);

      const assigneeWarnings = await this.handleUserAssignment(
        authManager,
        createdTask,
        task,
        entityMaps.userMap,
        entityMaps.projectUsers
      );
      warnings.push(...assigneeWarnings);

      if (task.reminders && task.reminders.length > 0) {
        warnings.push(this.handleReminders(createdTask.id, task.reminders as Array<{ reminder_date?: string; reminder?: string }>));
      }

      const result: TaskCreationResult = {
        success: true,
        taskId: createdTask.id ?? 0,
        title: createdTask.title ?? '',
      };

      if (warnings.length > 0) {
        result.warnings = warnings;
      }

      return result;
    } catch (error) {
      // Let MCPErrors bubble up to be handled at the batch level
      if (error instanceof MCPError) {
        throw error;
      }

      // If catchErrors is true, return error in result; otherwise, let it bubble up
      if (catchErrors) {
        return {
          success: false,
          title: task.title,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      } else {
        throw error;
      }
    }
  }

  /**
   * Prepares task data for API submission
   *
   * @param task - The imported task
   * @param projectId - The target project ID
   * @returns Formatted task data for the API
   */
  private prepareTaskData(task: ImportedTask, projectId: number): TaskCreationData {
    const taskData: TaskCreationData = {
      project_id: projectId,
      title: task.title,
      done: task.done || false,
      priority: task.priority || 0,
      percent_done: task.percentDone || 0,
    };

    // Only add description if it's not undefined
    if (task.description !== undefined) {
      taskData.description = task.description;
    }

    // Handle dates
    if (task.dueDate) taskData.due_date = task.dueDate;
    if (task.startDate) taskData.start_date = task.startDate;
    if (task.endDate) taskData.end_date = task.endDate;

    if (task.hexColor) taskData.hex_color = task.hexColor;

    if (task.repeatAfter) taskData.repeat_after = task.repeatAfter;
    if (task.repeatMode !== undefined) {
      const repeatModes = ['day', 'week', 'month', 'year'];
      if (task.repeatMode >= 0 && task.repeatMode < repeatModes.length) {
        const repeatMode = repeatModes[task.repeatMode];
        if (repeatMode) {
          taskData.repeat_mode = repeatMode;
        }
      }
    }

    return taskData;
  }

  /**
   * Creates the base task in Vikunja via `PUT /projects/{id}/tasks`
   * (direct-REST; see docs/ENDPOINT-PLAYBOOK.md §3 — legacy client is
   * end-of-life for this project).
   *
   * @param authManager - Active auth manager holding session credentials
   * @param taskData - Prepared task data
   * @param taskTitle - Task title for error reporting
   * @returns Created task
   * @throws MCPError if creation fails or authentication error occurs
   */
  private async createBaseTask(
    authManager: AuthManager,
    taskData: TaskCreationData,
    taskTitle: string
  ): Promise<VikunjaTask> {
    try {
      // Safely convert TaskCreationData to the request body shape Vikunja expects
      const taskForApi = convertTaskCreationDataToTask(taskData);
      return await vikunjaRestRequest<VikunjaTask>(
        authManager,
        'PUT',
        `/projects/${taskData.project_id}/tasks`,
        taskForApi,
      );
    } catch (error) {
      // Check if it's an authentication error. Checked directly via
      // `details.statusCode` (set by `vikunjaRestRequest` on every non-2xx
      // response) alongside the shared message-pattern classifier:
      // `isAuthenticationError`'s message patterns include some anchored to
      // the start of the string (e.g. `/^401\b/`), which stop matching once
      // `vikunjaRestRequestRaw` prefixes the message with its own "Vikunja
      // REST request failed (...)" context — the statusCode check keeps a
      // real 401/403 response reliably classified regardless of message
      // shape.
      const statusCode = error instanceof MCPError ? error.details?.statusCode : undefined;
      if (statusCode === 401 || statusCode === 403 || isAuthenticationError(error)) {
        throw new MCPError(
          ErrorCode.API_ERROR,
          `Authentication error while creating task "${taskTitle}". The token works for other endpoints but may have issues with batch operations. Original error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Re-throw as a plain Error, not the direct-REST helper's `MCPError`.
      // `createTask`'s outer catch treats an `instanceof MCPError` as
      // already-final and re-throws it unconditionally, bypassing the
      // `catchErrors`-gated graceful-degradation path below — that
      // short-circuit exists for OUR deliberately-thrown MCPErrors (like
      // the auth one just above), not for generic transport failures.
      // Pre-migration, the legacy client's `createTask` threw plain `Error`s
      // here (never `MCPError`), so `catchErrors` correctly gated whether a
      // non-auth API failure aborted the whole batch or was reported as a
      // per-task failure; unwrapping here restores that behavior instead of
      // letting every transport failure silently start behaving like an
      // auth failure now that `vikunjaRestRequest` always throws MCPError.
      throw error instanceof Error ? new Error(error.message) : error;
    }
  }

  /**
   * Handles label assignment for a created task
   *
   * @param authManager - Active auth manager holding the session credentials
   * @param createdTask - The task that was created
   * @param task - Original task data with labels
   * @param labelMap - Mapping of label names to IDs
   * @returns Array of warnings from label assignment
   */
  private async handleLabelAssignment(
    authManager: AuthManager,
    createdTask: VikunjaTask,
    task: ImportedTask,
    labelMap: Map<string, number>
  ): Promise<string[]> {
    const warnings: string[] = [];

    if (!task.labels || task.labels.length === 0) {
      return warnings;
    }

    // First, check for labels that are not found
    const notFoundLabels = task.labels.filter(
      (labelName) => !labelMap.has(labelName.toLowerCase()),
    );

    if (notFoundLabels.length > 0) {
      logger.warn('Some labels not found in project', {
        taskId: createdTask.id || 'unknown',
        requestedLabels: task.labels,
        notFoundLabels,
        availableLabels: Array.from(labelMap.keys()),
      });
      if (createdTask.id) {
        warnings.push(`Labels not found: ${notFoundLabels.join(', ')}`);
      }
    }

    // Get the label IDs that were found
    const labelIds = task.labels
      .map((labelName) => labelMap.get(labelName.toLowerCase()))
      .filter((id): id is number => id !== undefined);

    if (labelIds.length > 0 && createdTask.id) {
      try {
        // Try to update labels
        await setTaskLabels(authManager, createdTask.id, labelIds);

        // Verify the labels were actually assigned (API tokens may silently fail)
        const labelsActuallyAssigned = await this.verifyLabelAssignment(authManager, createdTask.id, labelIds);

        if (!labelsActuallyAssigned) {
          // Label assignment silently failed (common with API tokens)
          logger.warn('Label assignment may have failed silently', {
            taskId: createdTask.id,
            labelIds,
            labelNames: task.labels,
          });
          warnings.push(`Labels specified but not assigned (API token limitation). Consider using JWT authentication for label support.`);
        } else {
          logger.debug('Labels assigned and verified successfully', {
            taskId: createdTask.id,
            labelIds,
            labelNames: task.labels,
          });
        }
      } catch (labelError) {
        const warning = this.handleLabelAssignmentError(labelError as Error | { code?: string; message?: string }, createdTask.id, task.labels);
        warnings.push(warning);
      }
    }

    return warnings;
  }

  /**
   * Verifies that labels were actually assigned to a task
   *
   * @param authManager - Active auth manager holding the session credentials
   * @param taskId - The task ID to verify
   * @param expectedLabelIds - Labels that should be assigned
   * @returns True if labels are actually assigned, false otherwise
   */
  private async verifyLabelAssignment(
    authManager: AuthManager,
    taskId: number,
    expectedLabelIds: number[]
  ): Promise<boolean> {
    try {
      const updatedTask = await getTaskViaRest(authManager, taskId);
      if (updatedTask && updatedTask.labels && Array.isArray(updatedTask.labels)) {
        const assignedLabelIds = updatedTask.labels.map((l) => l.id);
        return expectedLabelIds.every((id) => assignedLabelIds.includes(id));
      }
      return false;
    } catch (verifyError) {
      // If we can't verify, assume it didn't work
      logger.debug('Could not verify label assignment', {
        taskId,
        error: verifyError instanceof Error ? verifyError.message : String(verifyError),
      });
      return false;
    }
  }

  /**
   * Handles errors during label assignment
   *
   * @param labelError - The error that occurred
   * @param taskId - The task ID
   * @param labelNames - The label names that were being assigned
   * @returns Warning message
   */
  private handleLabelAssignmentError(labelError: Error | { code?: string; message?: string }, taskId: number | undefined, labelNames: string[]): string {
    // Check if this is an authentication error
    if (isAuthenticationError(labelError)) {
      logger.warn('Label assignment failed due to authentication issue', {
        taskId,
        labelNames,
        error: labelError instanceof Error ? labelError.message : (labelError?.message ?? 'Unknown error'),
      });
      return `Label assignment requires JWT authentication. Labels were not assigned.`;
    } else {
      logger.error('Failed to assign labels to task', {
        taskId,
        labelNames,
        error: labelError instanceof Error ? labelError.message : (labelError?.message ?? 'Unknown error'),
      });
      return `Failed to assign labels: ${labelError instanceof Error ? labelError.message : 'Unknown error'}`;
    }
  }

  /**
   * Handles user assignment for a created task
   *
   * @param authManager - Active auth manager holding the session credentials
   * @param createdTask - The task that was created
   * @param task - Original task data with assignees
   * @param userMap - Mapping of usernames to IDs
   * @param projectUsers - List of available project users
   * @returns Array of warnings from user assignment
   */
  private async handleUserAssignment(
    authManager: AuthManager,
    createdTask: VikunjaTask,
    task: ImportedTask,
    userMap: Map<string, number>,
    projectUsers: VikunjaUser[]
  ): Promise<string[]> {
    const warnings: string[] = [];

    if (!task.assignees || task.assignees.length === 0) {
      return warnings;
    }

    // Check if we have any users mapped (might be empty due to API issue)
    if (projectUsers.length === 0) {
      logger.warn('Skipping assignees due to user fetch failure', {
        taskId: createdTask.id || 'unknown',
        assignees: task.assignees,
      });
      warnings.push('Assignees skipped due to user fetch failure (possible API authentication issue)');
      return warnings;
    }

    // Check for users that are not found first
    const notFoundUsers = task.assignees.filter(
      (username) => !userMap.has(username.toLowerCase()),
    );

    if (notFoundUsers.length > 0) {
      warnings.push(`Users not found: ${notFoundUsers.join(', ')}`);
    }

    // Get the user IDs that were found
    const userIds = task.assignees
      .map((username) => userMap.get(username.toLowerCase()))
      .filter((id): id is number => id !== undefined);

    if (userIds.length > 0 && createdTask.id) {
      try {
        // Assign each user via the ADDITIVE single-assign endpoint (PUT
        // /tasks/{taskID}/assignees, body { user_id }, models.TaskAssginee)
        // rather than the bulk endpoint (POST .../assignees/bulk), which
        // REPLACES the whole assignee list — a bulk call would silently
        // unassign everyone (upstream issue #15). Sequential on purpose
        // (post-#89 pattern sweep): concurrent per-user writes to the same
        // task risk "database is locked" 500s on SQLite-backed instances.
        const taskId = createdTask.id;
        for (const userId of userIds) {
          await vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, { user_id: userId });
        }
      } catch (assignError) {
        logger.error('Failed to assign users to task', {
          taskId: createdTask.id,
          userIds,
          assignees: task.assignees,
          error: assignError instanceof Error ? assignError.message : String(assignError),
        });
        warnings.push(`Failed to assign users: ${assignError instanceof Error ? assignError.message : 'Unknown error'}`);
      }
    }

    return warnings;
  }

  /**
   * Handles reminders for a task (API limitation)
   *
   * @param taskId - The task ID
   * @param reminders - Array of reminder data
   * @returns Warning message about API limitation
   */
  private handleReminders(taskId: number | undefined, reminders: Array<{ reminder_date?: string; reminder?: string }>): string {
    // Note: The API doesn't support adding reminders separately,
    // they need to be added during task creation
    // This is a limitation of the current implementation
    logger.warn('Reminders cannot be added after task creation', {
      taskId: taskId || 'unknown',
      reminders,
    });
    return 'Reminders cannot be added after task creation (API limitation). Include them in the initial task data.';
  }
}