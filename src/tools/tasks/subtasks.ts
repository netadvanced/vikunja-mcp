/**
 * Subtask composites for `vikunja_tasks`.
 *
 * Vikunja has no first-class "subtask" resource — a subtask is a plain task
 * connected to its parent by a `models.TaskRelation` with `relation_kind:
 * "subtask"` (see `src/tools/tasks-relations.ts`, the direction semantics
 * this module relies on).
 *
 * Direction, per `models.TaskRelation`'s field docs (`task_id`: "the ID of
 * the 'base' task, the task which has a relation to another"; `other_task_id`:
 * "the ID of the other task, the task which is being related"): a relation
 * created as `PUT /tasks/{parentId}/relations` with body `{task_id: parentId,
 * other_task_id: childId, relation_kind: "subtask"}` stores the child under
 * the *parent's* `related_tasks["subtask"]` — Vikunja mirrors the inverse
 * relation (`"parenttask"`) onto the child automatically server-side. So the
 * base task of the PUT must be the parent, not the new child.
 *
 * `create-subtask` (composite-first, docs/ENDPOINT-PLAYBOOK.md §1): resolves
 * the parent task to inherit its project, creates the new task in that
 * project, optionally attaches labels/assignees and places it in a Kanban
 * bucket (reusing the `set-bucket` code path), creates the parent -> child
 * `subtask` relation, then re-reads the parent to verify the relation
 * actually landed. Built on `CompositeOperation`
 * (`src/utils/composite-operation.ts`) — best-effort by default (a failure
 * after the task was created is reported honestly, including the orphaned
 * task id, rather than silently rolled back); `atomic: true` opts into
 * best-effort rollback (deleting the created task) per the helper's design.
 *
 * `list-subtasks` is a read composite: one `GET /tasks/{id}` call, filtered
 * to the `"subtask"` slice of `related_tasks` and summarized.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';
import { getTaskViaRest } from '../../utils/task-rest-transport';
import { validateId, sanitizeString } from '../../utils/validation';
import { validateDateString } from './validation';
import { transformApiError } from '../../utils/error-handler';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { CompositeOperation } from '../../utils/composite-operation';
import { setTaskBucket } from './buckets';
import type { components } from '../../types/generated/vikunja-openapi';

/** `models.Task` per the OpenAPI spec. */
type VikunjaTask = components['schemas']['models.Task'];
/** `models.TaskRelation` per the OpenAPI spec. */
type VikunjaTaskRelation = components['schemas']['models.TaskRelation'];

type McpResponse = { content: Array<{ type: 'text'; text: string }> };

/** Re-throws a 404 as a friendly not-found MCPError; everything else passes through `transformApiError`. */
function rethrow(error: unknown, notFoundMessage: string | undefined, context: string): never {
  if (error instanceof MCPError) {
    if (notFoundMessage && error.details?.statusCode === 404) {
      throw new MCPError(ErrorCode.NOT_FOUND, notFoundMessage);
    }
    throw error;
  }
  throw transformApiError(error, context);
}

/**
 * Reads one relation-kind slice out of a task's `related_tasks` map.
 * `related_tasks` (`models.RelatedTaskMap`) is a map of relation kind ->
 * `Task[]`, not a flat array — see the same pattern in
 * `src/tools/tasks-relations.ts`'s `relations` subcommand.
 */
function extractRelatedTasks(task: VikunjaTask, kind: string): VikunjaTask[] {
  const map = (task.related_tasks ?? {}) as unknown as Record<string, VikunjaTask[] | undefined>;
  const list = map[kind];
  return Array.isArray(list) ? list : [];
}

export interface CreateSubtaskArgs {
  /** Id of the existing task the new task becomes a subtask of. Its project is inherited. */
  parentTaskId?: number;
  title?: string;
  description?: string;
  dueDate?: string;
  priority?: number;
  labels?: number[];
  assignees?: number[];
  /** Optional Kanban bucket to place the new subtask into, via the existing `set-bucket` path. */
  bucketId?: number;
  /**
   * Opt into atomic rollback: if any later step fails, previously-succeeded
   * steps are compensated in reverse order (the created task is deleted).
   * Default `false` (best-effort) — see
   * docs/ENDPOINT-PLAYBOOK.md §5 / `CompositeOperation`'s design rule (a).
   * This is best-effort compensation against a live API, not a real
   * transaction: side effects of intermediate writes (e.g. any webhook the
   * task-create step fires) are not undone by the rollback.
   */
  atomic?: boolean;
  sessionId?: string;
}

/**
 * Composite: create a new task as a subtask of an existing task.
 *
 * Steps: resolve-parent (inherit project) -> create-task (compensatable:
 * delete on rollback) -> apply-labels / apply-assignees (only when supplied)
 * -> create-relation (parent -subtask-> child) -> set-bucket (only when
 * `bucketId` supplied, reuses `setTaskBucket`) -> verify-relation (re-reads
 * the parent's `related_tasks` to confirm the child actually appears under
 * `"subtask"`).
 */
export async function createSubtask(
  args: CreateSubtaskArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  if (!args.parentTaskId) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'parentTaskId is required to create a subtask');
  }
  validateId(args.parentTaskId, 'parentTaskId');

  if (!args.title) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'title is required to create a subtask');
  }
  const sanitizedTitle = sanitizeString(args.title);
  const sanitizedDescription =
    args.description !== undefined ? sanitizeString(args.description) : undefined;

  if (args.dueDate) {
    validateDateString(args.dueDate, 'dueDate');
  }
  if (args.labels && args.labels.length > 0) {
    args.labels.forEach((id) => validateId(id, 'label ID'));
  }
  if (args.assignees && args.assignees.length > 0) {
    args.assignees.forEach((id) => validateId(id, 'assignee ID'));
  }
  if (args.bucketId !== undefined) {
    validateId(args.bucketId, 'bucketId');
  }

  const parentTaskId = args.parentTaskId;
  let parentProjectId: number | undefined;
  let createdTaskId: number | undefined;

  const op = new CompositeOperation();

  op.addStep<VikunjaTask, undefined>({
    name: 'resolve-parent',
    execute: async () => {
      let parent: VikunjaTask;
      try {
        parent = await getTaskViaRest(authManager, parentTaskId);
      } catch (error) {
        rethrow(error, `Parent task ${parentTaskId} not found`, 'Failed to resolve parent task');
      }
      if (!parent || typeof parent.project_id !== 'number') {
        throw new MCPError(
          ErrorCode.NOT_FOUND,
          `Parent task ${parentTaskId} not found or has no project`,
        );
      }
      parentProjectId = parent.project_id;
      return parent;
    },
  });

  op.addStep<VikunjaTask, undefined>({
    name: 'create-task',
    execute: async () => {
      const projectId = parentProjectId as number;
      const newTask: VikunjaTask = { title: sanitizedTitle, project_id: projectId };
      if (sanitizedDescription !== undefined) newTask.description = sanitizedDescription;
      if (args.dueDate !== undefined) newTask.due_date = args.dueDate;
      if (args.priority !== undefined) newTask.priority = args.priority;

      let created: VikunjaTask;
      try {
        created = await vikunjaRestRequest<VikunjaTask>(
          authManager,
          'PUT',
          `/projects/${projectId}/tasks`,
          newTask,
        );
      } catch (error) {
        rethrow(error, undefined, 'Failed to create subtask');
      }
      if (!created.id) {
        throw new MCPError(
          ErrorCode.API_ERROR,
          'Subtask was created but Vikunja did not return a task id',
        );
      }
      createdTaskId = created.id;
      return created;
    },
    compensate: async () => {
      if (createdTaskId === undefined) return undefined;
      await vikunjaRestRequest(authManager, 'DELETE', `/tasks/${createdTaskId}`);
      return undefined;
    },
  });

  if (args.labels && args.labels.length > 0) {
    const labelIds = args.labels;
    op.addStep<undefined, undefined>({
      name: 'apply-labels',
      execute: async () => {
        const taskId = createdTaskId as number;
        // Additive per-label endpoint (PUT /tasks/{taskID}/labels, body
        // {label_id}) — same as apply-label / TaskCreationService.
        // Intentionally sequential: label attach order should not matter,
        // but keeping it simple avoids a Promise.all partial-failure
        // ordering surprise across labels.
        for (const labelId of labelIds) {
          await vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/labels`, {
            label_id: labelId,
          });
        }
      },
    });
  }

  if (args.assignees && args.assignees.length > 0) {
    const assigneeIds = args.assignees;
    op.addStep<undefined, undefined>({
      name: 'apply-assignees',
      execute: async () => {
        const taskId = createdTaskId as number;
        // Additive per-user endpoint (PUT /tasks/{taskID}/assignees, body
        // {user_id}) — never the bulk endpoint, which REPLACES the whole
        // assignee list (see TaskCreationService.addAssigneesToTask).
        await Promise.all(
          assigneeIds.map((userId) =>
            vikunjaRestRequest(authManager, 'PUT', `/tasks/${taskId}/assignees`, {
              user_id: userId,
            }),
          ),
        );
      },
    });
  }

  op.addStep<VikunjaTaskRelation, undefined>({
    name: 'create-relation',
    execute: async () => {
      const childId = createdTaskId as number;
      try {
        // Base task (task_id) of the relation must be the PARENT — see the
        // module doc comment for the direction semantics this depends on.
        return await vikunjaRestRequest<VikunjaTaskRelation>(
          authManager,
          'PUT',
          `/tasks/${parentTaskId}/relations`,
          {
            task_id: parentTaskId,
            other_task_id: childId,
            relation_kind: 'subtask',
          } satisfies VikunjaTaskRelation,
        );
      } catch (error) {
        rethrow(error, undefined, 'Failed to relate subtask to parent task');
      }
    },
  });

  if (args.bucketId !== undefined) {
    const bucketId = args.bucketId;
    op.addStep<undefined, undefined>({
      name: 'set-bucket',
      execute: async () => {
        const taskId = createdTaskId as number;
        const projectId = parentProjectId as number;
        // Reuses the existing set-bucket path (Kanban view auto-resolution
        // + the bucket-placement write) rather than duplicating it. Its own
        // formatted MCP response is discarded — only the side effect (the
        // task landing in the bucket) matters to this composite.
        await setTaskBucket({ id: taskId, bucketId, projectId }, authManager);
      },
    });
  }

  op.addStep<boolean, undefined>({
    name: 'verify-relation',
    execute: async () => {
      const childId = createdTaskId as number;
      let parent: VikunjaTask;
      try {
        parent = await getTaskViaRest(authManager, parentTaskId);
      } catch (error) {
        rethrow(error, undefined, 'Failed to verify subtask relation');
      }
      const subtasks = extractRelatedTasks(parent, 'subtask');
      const found = subtasks.some((t) => t.id === childId);
      if (!found) {
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Subtask ${childId} was created and related to parent ${parentTaskId} but did not ` +
            `appear under the parent's "subtask" relations on verification`,
        );
      }
      return true;
    },
  });

  const atomic = args.atomic ?? false;
  const result = await op.run({ atomic });

  if (!result.ok) {
    const err = result.error instanceof Error ? result.error : new Error(String(result.error));
    throw new MCPError(
      err instanceof MCPError ? err.code : ErrorCode.API_ERROR,
      `create-subtask failed: ${err.message}${result.guidance ? `\n${result.guidance}` : ''}`,
      { vikunjaError: result },
    );
  }

  const response = createStandardResponse(
    'create-subtask',
    `Created subtask ${createdTaskId} ("${sanitizedTitle}") under parent task ${parentTaskId}`,
    {
      subtaskId: createdTaskId,
      parentTaskId,
      projectId: parentProjectId,
      bucketId: args.bucketId,
      atomic,
      trace: result.steps,
    },
    { timestamp: new Date().toISOString() },
    args.sessionId,
  );

  return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
}

export interface ListSubtasksArgs {
  /** Id of the task whose subtasks should be listed. */
  id?: number;
  sessionId?: string;
}

/** Minimal per-subtask summary returned by `list-subtasks`. */
interface SubtaskSummary {
  id: number | undefined;
  title: string | undefined;
  done: boolean | undefined;
  assignees: Array<{ id: number | undefined; username: string | undefined }>;
}

/**
 * Read composite: lists a task's subtasks in one call — the `"subtask"`
 * slice of `GET /tasks/{id}`'s `related_tasks` map, summarized to
 * id/title/done/assignees rather than the full related `Task` objects.
 */
export async function listSubtasks(args: ListSubtasksArgs, authManager: AuthManager): Promise<McpResponse> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task ID is required');
  }
  validateId(args.id, 'id');

  let task: VikunjaTask;
  try {
    task = await getTaskViaRest(authManager, args.id);
  } catch (error) {
    rethrow(error, `Task ${args.id} not found`, 'Failed to list subtasks');
  }

  const subtasks: SubtaskSummary[] = extractRelatedTasks(task, 'subtask').map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    assignees: (t.assignees ?? []).map((a) => ({ id: a.id, username: a.username })),
  }));

  const response = createStandardResponse(
    'list-subtasks',
    subtasks.length > 0
      ? `Found ${subtasks.length} subtask(s) for task ${args.id}`
      : `Found 0 subtasks for task ${args.id}`,
    { taskId: args.id, subtasks, count: subtasks.length },
    { timestamp: new Date().toISOString(), count: subtasks.length },
    args.sessionId,
  );

  return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
}
