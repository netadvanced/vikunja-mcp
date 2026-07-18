/**
 * Simplified bulk operations for tasks (~250 lines)
 *
 * This superseded the old bulk/ implementation (BulkOperationProcessor,
 * BulkOperationErrorHandler, BatchProcessorFactory), which was dead code -
 * unreachable from src/tools/index.ts or src/tools/tasks/index.ts - and has
 * since been deleted. Only BulkOperationValidator survives from that folder,
 * reused here for its field/value validation.
 */

import { MCPError, ErrorCode, createStandardResponse, logger, isAuthenticationError, RETRY_CONFIG, transformApiError, handleFetchError } from '../../index';
import type { AuthManager } from '../../auth/AuthManager';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';
import { getTaskViaRest } from '../../utils/task-rest-transport';
import { withRetry } from '../../utils/retry';
import { setTaskLabels } from '../../utils/label-bulk';
import { BatchProcessor } from '../../utils/performance/batch-processor';
import type { components } from '../../types/generated/vikunja-openapi';
import { convertRepeatConfiguration, applyFieldUpdate } from './validation';
import { formatAorpAsMarkdown } from '../../utils/response-factory';
import { AUTH_ERROR_MESSAGES, REPEAT_MODE_MAP } from './constants';
import { bulkOperationValidator } from './bulk/BulkOperationValidator';
import type { BulkUpdateArgs, BulkDeleteArgs, BulkCreateArgs, BulkCreateTaskData } from './bulk/BulkOperationValidator';

/** `models.Task` per the OpenAPI spec — request/response shape for the task endpoints. */
type Task = components['schemas']['models.Task'];
/** `models.BulkTask` per the OpenAPI spec — request/response shape for POST /tasks/bulk. */
type BulkTask = components['schemas']['models.BulkTask'];

// ==================== BATCH PROCESSORS ====================

const processors = {
  update: new BatchProcessor({ maxConcurrency: 5, batchSize: 10, enableMetrics: true, batchDelay: 0 }),
  delete: new BatchProcessor({ maxConcurrency: 3, batchSize: 5, enableMetrics: true, batchDelay: 100 }),
  create: new BatchProcessor({ maxConcurrency: 8, batchSize: 15, enableMetrics: true, batchDelay: 0 }),
};

// ==================== VALIDATION WRAPPERS ====================

// Re-use validation logic from BulkOperationValidator to eliminate duplication
const validateBulkUpdate = (args: BulkUpdateArgs): void => {
  bulkOperationValidator.validateBulkUpdate(args);
  bulkOperationValidator.preprocessFieldValue(args);
  bulkOperationValidator.validateFieldConstraints(args);
};

const validateBulkCreate = (args: BulkCreateArgs): void => bulkOperationValidator.validateBulkCreate(args);
const validateBulkDelete = (args: BulkDeleteArgs): void => bulkOperationValidator.validateBulkDelete(args);

// Re-export types for backward compatibility
export type { BulkUpdateArgs, BulkDeleteArgs, BulkCreateArgs, BulkCreateTaskData };

// ==================== RESPONSE HELPERS ====================

interface SuccessResponse {
  content: Array<{ type: 'text'; text: string }>;
}

const successResponse = (op: string, msg: string, tasks: Task[], meta: Record<string, unknown>): SuccessResponse => ({
  content: [{ type: 'text' as const, text: formatAorpAsMarkdown(createStandardResponse(op, msg, { tasks } as unknown as Parameters<typeof createStandardResponse>[2], { timestamp: new Date().toISOString(), ...meta })) }]
});

/**
 * Resolve bulk-update field value for Vikunja's updateTask payload.
 * Native bulk API used a numeric repeat_mode map; keep that conversion when merging.
 */
function resolveBulkUpdateValue(field: string | undefined, value: unknown): unknown {
  if (field === 'repeat_mode' && typeof value === 'string') {
    return REPEAT_MODE_MAP[value] ?? value;
  }
  return value;
}

// ==================== BULK UPDATE ====================

/**
 * Bulk-update.
 *
 * Scalar fields go through Vikunja's native `POST /tasks/bulk` in ONE request.
 * The endpoint's real contract (see `models.BulkTask` in the generated OpenAPI
 * types) is `{ task_ids, fields: string[], values: models.Task }` — the server
 * applies exactly the listed fields and preserves everything else. The old
 * belief that the endpoint full-replaces tasks came from node-vikunja's stale
 * `{ task_ids, field, value }` type (upstream #46): with that malformed payload
 * the server sees `fields: null` and applies a zero-value task. A single
 * request also sidesteps the `database is locked` partial failures that
 * concurrent per-task updates hit on SQLite-backed instances (upstream #79).
 *
 * Two server-side caveats handled here (verified against live 2.3.0):
 * - the bulk endpoint clears assignees even for a correctly-scoped update, so
 *   assignees are snapshotted first and re-added afterwards;
 * - assignees/labels cannot be set through the bulk endpoint at all, so those
 *   fields use the per-task path.
 */
export async function bulkUpdateTasks(args: BulkUpdateArgs, authManager: AuthManager): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    validateBulkUpdate(args);
    // Validation ensures taskIds exists
    const taskIds = args.taskIds ?? [];
    const fieldValue = resolveBulkUpdateValue(args.field, args.value);

    const perTaskUpdate = async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    const updateResult = await processors.update.processBatches(taskIds, async (taskId) => {
        const current = await vikunjaRestRequest<Task>(authManager, 'GET', `/tasks/${taskId}`);
        // Spread current task so fields not being changed survive Vikunja's full replace
        const update = applyFieldUpdate({ ...current }, args.field, fieldValue);

        const updated = await vikunjaRestRequest<Task>(authManager, 'POST', `/tasks/${taskId}`, update);

        if (args.field === 'assignees' && Array.isArray(args.value)) {
          const currentTask = await getTaskViaRest(authManager, taskId);
          const currentAssignees = (currentTask.assignees ?? [])
            .map((a) => a.id)
            .filter((id): id is number => typeof id === 'number');
          if (args.value.length > 0) {
            try {
              // Per-user additive assign (PUT /tasks/{taskID}/assignees, body
              // { user_id }, models.TaskAssginee) instead of the bulk endpoint,
              // which REPLACES the whole list and would silently unassign
              // everyone (upstream issue #15). Run concurrently.
              await Promise.all((args.value as number[]).map((userId) => withRetry(() => vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, { user_id: userId }), { ...RETRY_CONFIG.AUTH_ERRORS, shouldRetry: isAuthenticationError })));
            } catch (assigneeError) {
              if (isAuthenticationError(assigneeError)) throw new MCPError(ErrorCode.API_ERROR, 'Assignee operations may have authentication issues');
              throw assigneeError;
            }
          }
          // DELETE /tasks/{taskID}/assignees/{userID} per the OpenAPI spec — no body.
          for (const userId of currentAssignees) {
            try { await withRetry(() => vikunjaRestRequest(authManager, 'DELETE', `/tasks/${taskId}/assignees/${userId}`), { ...RETRY_CONFIG.AUTH_ERRORS, shouldRetry: isAuthenticationError }); }
            catch (e) { if (isAuthenticationError(e)) throw new MCPError(ErrorCode.API_ERROR, `${AUTH_ERROR_MESSAGES.ASSIGNEE_REMOVE_PARTIAL} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times)`); throw e; }
          }
        }
        // Labels are never applied by Vikunja's task update payload; persist them
        // explicitly via setTaskLabels (correct labels payload shape) — re-impl #49.
        if (args.field === 'labels' && Array.isArray(args.value)) {
          await withRetry(() => setTaskLabels(authManager, taskId, args.value as number[]), { ...RETRY_CONFIG.AUTH_ERRORS, shouldRetry: isAuthenticationError });
        }
        return updated;
      });
      if (updateResult.failed.length > 0 && updateResult.successful.length === 0) {
        const firstError = updateResult.failed[0]?.error;
        // Preserve MCPError instances with auth messages
        if (firstError instanceof MCPError && firstError.message.includes('authentication')) throw firstError;
        throw new MCPError(ErrorCode.API_ERROR, `Bulk update failed. Could not update any tasks. Failed IDs: ${updateResult.failed.map(f => f.originalItem).join(', ')}`);
      }
      // Report partial failure honestly (mirrors bulkDeleteTasks) instead of
      // claiming every task was updated.
      if (updateResult.failed.length > 0) {
        const failedIds = updateResult.failed.map(f => f.originalItem);
        return successResponse('update-task', `Bulk update partially completed. Successfully updated ${updateResult.successful.length} tasks. Failed task IDs: ${failedIds.join(', ')}`, updateResult.successful, {
          count: updateResult.successful.length, failedCount: updateResult.failed.length, failedIds, affectedFields: [args.field], success: false,
        });
      }
      return successResponse('update-task', `Successfully updated ${taskIds.length} tasks`, updateResult.successful, {
        count: taskIds.length, affectedFields: [args.field], performanceMetrics: {
          totalDuration: updateResult.metrics.totalDuration, operationsPerSecond: updateResult.metrics.operationsPerSecond,
          apiCallsUsed: updateResult.metrics.successfulOperations + updateResult.metrics.failedOperations,
        },
      });
    };

    // Assignees and labels have their own endpoints; the native bulk endpoint
    // does not handle them.
    if (args.field === 'assignees' || args.field === 'labels') {
      return await perTaskUpdate();
    }

    try {
      // Snapshot assignees first: the bulk endpoint clears them server-side
      // even for a correctly-scoped update (verified against 2.3.0).
      const preFetch = await processors.update.processBatches(taskIds, async (id) => await vikunjaRestRequest<Task>(authManager, 'GET', `/tasks/${id}`));
      const assigneesByTask = new Map<number, number[]>();
      for (const t of preFetch.successful) {
        if (!t?.id) continue;
        const ids = (t.assignees ?? []).map((a) => a.id).filter((id): id is number => typeof id === 'number');
        if (ids.length > 0) assigneesByTask.set(t.id, ids);
      }

      const payload: BulkTask = {
        task_ids: taskIds,
        fields: [args.field as string],
        values: { [args.field as string]: fieldValue } as Task,
      };
      const result = await vikunjaRestRequest<BulkTask | Task[]>(authManager, 'POST', '/tasks/bulk', payload);

      // 2.x echoes { task_ids, fields, values, tasks }; tolerate a bare Task[] too.
      // The honesty check below is derived from THIS array — the server's own
      // account of what it updated — never from the requested taskIds.
      const updatedTasks: Task[] = Array.isArray(result) ? result : (result?.tasks ?? []);
      // Sanity-check the server actually applied the value — guards against
      // running into an older server that ignores fields/values.
      const verifiable = ['priority', 'done', 'project_id'].includes(args.field as string);
      const applied = updatedTasks.length > 0 && (!verifiable || updatedTasks.every((t) => t[args.field as keyof Task] === fieldValue));
      if (!applied) {
        throw new MCPError(ErrorCode.API_ERROR, 'Native bulk update did not apply the requested value');
      }

      // A server that silently drops a subset of the requested IDs
      // (permissions, partial bulk transaction) must not be reported as a
      // full success. Match the server-returned IDs against what was asked for.
      const returnedIds = new Set(updatedTasks.map((t) => t.id).filter((id): id is number => typeof id === 'number'));
      const missingIds = taskIds.filter((id) => !returnedIds.has(id));

      // Re-add the assignees the bulk endpoint cleared. Sequential on purpose:
      // concurrent writes 500 with "database is locked" on SQLite backends.
      // Failures are collected (not just logged) so a lost assignee is
      // surfaced to the caller rather than silently swallowed.
      const assigneeRestoreFailures: Array<{ taskId: number; userId: number }> = [];
      for (const [taskId, userIds] of assigneesByTask) {
        for (const userId of userIds) {
          try {
            await vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, { user_id: userId });
          } catch (e) {
            logger.warn('Could not restore assignee after bulk update', { taskId, userId, error: e instanceof Error ? e.message : String(e) });
            assigneeRestoreFailures.push({ taskId, userId });
          }
        }
      }

      // Re-fetch when assignees were restored so the response reflects them.
      // This is presentation only — it does not feed the honesty check above,
      // which stays fixed to what POST /tasks/bulk itself returned.
      const responseTasks = assigneesByTask.size > 0
        ? (await processors.update.processBatches(taskIds, async (id) => await vikunjaRestRequest<Task>(authManager, 'GET', `/tasks/${id}`))).successful
        : updatedTasks;

      if (missingIds.length > 0 || assigneeRestoreFailures.length > 0) {
        const messages: string[] = [
          missingIds.length > 0
            ? `Bulk update partially completed. Successfully updated ${updatedTasks.length} tasks. Failed task IDs: ${missingIds.join(', ')}`
            : `Successfully updated ${updatedTasks.length} tasks`,
        ];
        if (assigneeRestoreFailures.length > 0) {
          const restoreFailedTaskIds = [...new Set(assigneeRestoreFailures.map((f) => f.taskId))];
          messages.push(`Assignee restoration failed for task(s): ${restoreFailedTaskIds.join(', ')}.`);
        }
        return successResponse('update-task', messages.join(' '), responseTasks, {
          count: updatedTasks.length,
          affectedFields: [args.field],
          success: false,
          ...(missingIds.length > 0 && { failedCount: missingIds.length, failedIds: missingIds }),
          ...(assigneeRestoreFailures.length > 0 && { assigneeRestoreFailures }),
        });
      }

      return successResponse('update-task', `Successfully updated ${taskIds.length} tasks`, responseTasks, { count: taskIds.length, affectedFields: [args.field] });
    } catch (nativeError) {
      if (nativeError instanceof MCPError && nativeError.message.includes('authentication')) throw nativeError;
      logger.warn('Native bulk update failed; falling back to per-task merge', { error: nativeError instanceof Error ? nativeError.message : String(nativeError), field: args.field });
      return await perTaskUpdate();
    }
  } catch (error) {
    if (error instanceof MCPError) throw error;
    if (error instanceof Error && (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND'))) throw handleFetchError(error, 'bulk update tasks');
    throw transformApiError(error, 'Failed to bulk update tasks');
  }
}

// ==================== BULK DELETE ====================

export async function bulkDeleteTasks(args: BulkDeleteArgs, authManager: AuthManager): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    validateBulkDelete(args);
    // Validation ensures taskIds exists
    const taskIds = args.taskIds ?? [];

    const fetchResult = await processors.delete.processBatches(taskIds, async (id) => await vikunjaRestRequest<Task>(authManager, 'GET', `/tasks/${id}`));
    const deletionResult = await processors.delete.processBatches(taskIds, async (id) => { await vikunjaRestRequest(authManager, 'DELETE', `/tasks/${id}`); return { taskId: id, deleted: true }; });

    if (deletionResult.failed.length > 0) {
      const failedIds = deletionResult.failed.map(f => f.originalItem);
      if (deletionResult.successful.length > 0) {
        return successResponse('delete-task', `Bulk delete partially completed. Successfully deleted ${deletionResult.successful.length} tasks. Failed to delete task IDs: ${failedIds.join(', ')}`, [], {
          count: deletionResult.successful.length, failedCount: deletionResult.failed.length, failedIds, previousState: fetchResult.successful, success: false,
        });
      }
      throw new MCPError(ErrorCode.API_ERROR, `Bulk delete failed. Could not delete any tasks. Failed IDs: ${failedIds.join(', ')}`);
    }

    return successResponse('delete-task', `Successfully deleted ${taskIds.length} tasks`, [], { count: taskIds.length, deletedTaskIds: taskIds, previousState: fetchResult.successful });
  } catch (error) {
    if (error instanceof MCPError) throw error;
    if (error instanceof Error && (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND'))) throw handleFetchError(error, 'bulk delete tasks');
    throw transformApiError(error, 'Failed to bulk delete tasks');
  }
}

// ==================== BULK CREATE ====================

export async function bulkCreateTasks(args: BulkCreateArgs, authManager: AuthManager): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    validateBulkCreate(args);
  } catch (error) {
    // Preserve validation errors
    if (error instanceof MCPError) throw error;
    throw error;
  }

  try {
    // Validation ensures projectId and tasks exist
    const projectId = args.projectId ?? 0;
    const tasks = args.tasks ?? [];

    const creationResult = await processors.create.processBatches(
      tasks.map((_, i) => i),
      async (index) => {
        const t = tasks[index];
        if (!t) throw new Error(`Task data at index ${index} is undefined`);

        const newTask: Task = { title: t.title, project_id: projectId };
        if (t.description !== undefined) newTask.description = t.description;
        if (t.dueDate !== undefined) newTask.due_date = t.dueDate;
        if (t.priority !== undefined) newTask.priority = t.priority;
        if (t.repeatAfter !== undefined || t.repeatMode !== undefined) {
          const rc = convertRepeatConfiguration(t.repeatAfter, t.repeatMode);
          if (rc.repeat_after !== undefined) newTask.repeat_after = rc.repeat_after;
          if (rc.repeat_mode !== undefined) newTask.repeat_mode = rc.repeat_mode as 0 | 1 | 2;
        }

        // PUT /projects/{id}/tasks per the OpenAPI spec (models.Task body).
        const created = await vikunjaRestRequest<Task>(authManager, 'PUT', `/projects/${projectId}/tasks`, newTask);
        if (!created.id) return created;

        // Narrow type - id is guaranteed to exist after early return
        const createdId = created.id;

        try {
          const labels = t.labels;
          if (labels && labels.length > 0) await withRetry(() => setTaskLabels(authManager, createdId, labels), { maxRetries: RETRY_CONFIG.AUTH_ERRORS.maxRetries ?? 3, timeout: (RETRY_CONFIG.AUTH_ERRORS.initialDelay ?? 1000) + (RETRY_CONFIG.AUTH_ERRORS.maxDelay ?? 10000), shouldRetry: isAuthenticationError });
          const assignees = t.assignees;
          if (assignees && assignees.length > 0) {
            try {
              // Per-user additive assign (PUT /tasks/{taskID}/assignees, body
              // { user_id }, models.TaskAssginee) instead of the bulk endpoint,
              // which REPLACES the list and would silently unassign everyone
              // (upstream issue #15). Run concurrently.
              await Promise.all(assignees.map((userId) => withRetry(() => vikunjaRestRequest(authManager, 'PUT', `/tasks/${createdId}/assignees`, { user_id: userId }), { maxRetries: RETRY_CONFIG.AUTH_ERRORS.maxRetries ?? 3, timeout: (RETRY_CONFIG.AUTH_ERRORS.initialDelay ?? 1000) + (RETRY_CONFIG.AUTH_ERRORS.maxDelay ?? 10000), shouldRetry: isAuthenticationError })));
            } catch (assigneeError) {
              if (isAuthenticationError(assigneeError)) {
                throw new MCPError(ErrorCode.API_ERROR, 'Assignee operations may have authentication issues');
              }
              // Wrap assignee errors to distinguish from createTask errors
              if (assigneeError instanceof Error) {
                const wrappedError = new MCPError(ErrorCode.API_ERROR, assigneeError.message);
                (wrappedError as unknown as Record<string, unknown>).isLabelAssigneeError = true;
                throw wrappedError;
              }
              throw assigneeError;
            }
          }
          return await vikunjaRestRequest<Task>(authManager, 'GET', `/tasks/${createdId}`);
        } catch (updateError) {
          // Clean up the created task since labels/assignees failed
          try { await vikunjaRestRequest(authManager, 'DELETE', `/tasks/${createdId}`); } catch (deleteError) { logger.error('Cleanup failed', deleteError); }
          // Wrap label errors to distinguish from createTask errors
          if (updateError instanceof Error && !(updateError instanceof MCPError)) {
            const wrappedError = new MCPError(ErrorCode.API_ERROR, updateError.message);
            (wrappedError as unknown as Record<string, unknown>).isLabelAssigneeError = true;
            throw wrappedError;
          }
          throw updateError;
        }
      }
    );

    const failedTasks = creationResult.failed.map(f => ({ index: f.originalItem as number, error: f.error instanceof Error ? f.error.message : String(f.error) }));
    if (failedTasks.length > 0 && creationResult.successful.length === 0) {
      const firstError = creationResult.failed[0]?.error;
      // Preserve MCPError instances with auth messages or label/assignee marker
      if (firstError instanceof MCPError && (firstError.message.includes('authentication') || (firstError as unknown as Record<string, unknown>).isLabelAssigneeError === true)) throw firstError;
      // Transform all other errors (including API errors) into generic bulk create error
      throw new MCPError(ErrorCode.API_ERROR, `Bulk create failed. Could not create any tasks`);
    }

    return successResponse('create-tasks', failedTasks.length > 0 ? `Bulk create partially completed. Successfully created ${creationResult.successful.length} tasks, ${failedTasks.length} failed.` : `Successfully created ${creationResult.successful.length} tasks`, creationResult.successful, {
      count: creationResult.successful.length, success: failedTasks.length === 0, ...(failedTasks.length > 0 && { failedCount: failedTasks.length, failures: failedTasks }),
    });
  } catch (error) {
    // Preserve MCPError instances from validation
    if (error instanceof MCPError) throw error;
    // Preserve fetch/connection errors
    if (error instanceof Error && (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND'))) {
      throw handleFetchError(error, 'bulk create tasks');
    }
    // Transform all other errors into generic bulk create error
    throw new MCPError(ErrorCode.API_ERROR, 'Bulk create failed. Could not create any tasks');
  }
}
