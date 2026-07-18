import { logger } from '../utils/logger';
import type { TaskCreationData } from '../types';
import { MCPError, ErrorCode } from '../types';
import { isAuthenticationError } from '../utils/auth-error-handler';
import { setTaskLabels } from '../utils/label-bulk';
import type { Task, Label, User } from 'node-vikunja';
import type { TypedVikunjaClient } from '../types/node-vikunja-extended';
import type { ImportedTask } from '../parsers/InputParserFactory';
import type { EntityResolutionResult } from './EntityResolver';
import type { AuthManager } from '../auth/AuthManager';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import type { components } from '../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json).
type VikunjaTask = components['schemas']['models.Task'];

/**
 * Converts TaskCreationData to a Task object compatible with node-vikunja API
 * This ensures type safety by properly mapping fields and handling optional properties
 */
function convertTaskCreationDataToTask(taskData: TaskCreationData): Task {
  // TaskCreationData is a subset of Task with all the required fields for API creation
  // The node-vikunja Task interface accepts these fields, making them compatible
  const convertedTask: Task = {
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
   * @param client - The Vikunja client instance
   * @param authManager - Active auth manager, used for the direct-REST task
   *   creation call (see `createBaseTask`)
   * @param entityMaps - Resolved entity mappings for labels and users
   * @param catchErrors - Whether to catch errors and return them in TaskCreationResult (default: true)
   * @returns Promise<TaskCreationResult> - Result of the task creation operation
   */
  async createTask(
    task: ImportedTask,
    projectId: number,
    client: TypedVikunjaClient,
    authManager: AuthManager,
    entityMaps: EntityResolutionResult,
    catchErrors: boolean = true
  ): Promise<TaskCreationResult> {
    const warnings: string[] = [];

    try {
      const taskData = this.prepareTaskData(task, projectId);

      const createdTask = await this.createBaseTask(authManager, taskData, task.title);

      const labelWarnings = await this.handleLabelAssignment(
        client,
        createdTask,
        task,
        entityMaps.labelMap
      );
      warnings.push(...labelWarnings);

      const assigneeWarnings = await this.handleUserAssignment(
        client,
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
        title: createdTask.title,
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
   * (direct-REST; see docs/ENDPOINT-PLAYBOOK.md §3 — node-vikunja is
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
  ): Promise<Task> {
    try {
      // Safely convert TaskCreationData to the request body shape Vikunja expects
      const taskForApi = convertTaskCreationDataToTask(taskData);
      const created = await vikunjaRestRequest<VikunjaTask>(
        authManager,
        'PUT',
        `/projects/${taskData.project_id}/tasks`,
        taskForApi,
      );
      // The OpenAPI-generated response type marks every field optional (Go
      // `omitempty` semantics), but a successful task creation always
      // returns title/project_id — matching node-vikunja's typed `Task`,
      // which the label/assignee/reminder helpers below (out of this
      // migration's scope; see docs/ENDPOINT-PLAYBOOK.md) still consume.
      return created as unknown as Task;
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
      // Pre-migration, node-vikunja's `createTask` threw plain `Error`s
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
   * @param client - The Vikunja client
   * @param createdTask - The task that was created
   * @param task - Original task data with labels
   * @param labelMap - Mapping of label names to IDs
   * @returns Array of warnings from label assignment
   */
  private async handleLabelAssignment(
    client: TypedVikunjaClient,
    createdTask: Task,
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
        await setTaskLabels(client, createdTask.id, labelIds);

        // Verify the labels were actually assigned (API tokens may silently fail)
        const labelsActuallyAssigned = await this.verifyLabelAssignment(client, createdTask.id, labelIds);

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
   * @param client - The Vikunja client
   * @param taskId - The task ID to verify
   * @param expectedLabelIds - Labels that should be assigned
   * @returns True if labels are actually assigned, false otherwise
   */
  private async verifyLabelAssignment(
    client: TypedVikunjaClient,
    taskId: number,
    expectedLabelIds: number[]
  ): Promise<boolean> {
    try {
      const updatedTask = await client.tasks.getTask(taskId);
      if (updatedTask && updatedTask.labels && Array.isArray(updatedTask.labels)) {
        const assignedLabelIds = updatedTask.labels.map((l: Label) => l.id);
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
   * @param client - The Vikunja client
   * @param createdTask - The task that was created
   * @param task - Original task data with assignees
   * @param userMap - Mapping of usernames to IDs
   * @param projectUsers - List of available project users
   * @returns Array of warnings from user assignment
   */
  private async handleUserAssignment(
    client: TypedVikunjaClient,
    createdTask: Task,
    task: ImportedTask,
    userMap: Map<string, number>,
    projectUsers: User[]
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
        // Assign each user via the ADDITIVE single-assign endpoint rather than
        // the bulk endpoint. node-vikunja's bulkAssignUsersToTask sends
        // `{ user_ids }` to Vikunja's bulk endpoint, which expects `{ assignees }`
        // and REPLACES the whole assignee list — the mismatched field is parsed
        // as "assign nobody", silently unassigning everyone (upstream issue #15).
        const taskId = createdTask.id;
        await Promise.all(userIds.map((userId) => client.tasks.assignUserToTask(taskId, userId)));
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