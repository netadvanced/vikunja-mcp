/**
 * Tasks Tool
 * Handles task operations for Vikunja
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../../auth/AuthManager';
import type { VikunjaClientFactory } from '../../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../../types';
import { getAuthManagerFromContext, setGlobalClientFactory } from '../../client';
import { logger } from '../../utils/logger';
import { storageManager } from '../../storage';
import { getEffectiveSessionId } from '../../context/requestContext';
import { relationSchema, handleRelationSubcommands } from '../tasks-relations';
import { TaskFilteringOrchestrator } from './filtering';
import type { TaskListingArgs } from './types/filters';
import { createAuthRequiredError, handleFetchError } from '../../utils/error-handler';
import { formatAorpAsMarkdown } from '../../utils/response-factory';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../../utils/read-only';


// Import all operation handlers
import { createTask, getTask, updateTask, deleteTask, createTaskResponse } from './crud';
import { bulkCreateTasks, bulkUpdateTasks, bulkDeleteTasks } from './bulk-operations';
import { assignUsers, unassignUsers, listAssignees } from './assignees';
import { handleComment } from './comments';
import { addReminder, removeReminder, listReminders } from './reminders';
import { applyLabels, removeLabels, listTaskLabels } from './labels';
import { attachSchemaFields, handleAttach, type TaskAttachArgs } from './attach';
import {
  listAttachments,
  getAttachmentInfo,
  deleteAttachment,
  downloadAttachment,
  type AttachmentSubcommandArgs,
} from './attachments';
import { setTaskBucket, bulkSetTaskBucket } from './buckets';
import { setTaskPosition } from './position';
import { getTaskByIndex } from './by-index';
import { createSubtask, listSubtasks, bulkCreateSubtasks } from './subtasks';
import { duplicateTask } from './duplicate';
import { markTaskRead } from './mark-read';


/**
 * Get session-scoped storage instance.
 *
 * The session id is `(issuer,sub)`-keyed in `oidc-http` mode and falls back
 * to the original apiUrl+token-prefix derivation in `stdio` mode — see
 * `getEffectiveSessionId` (docs/OIDC-RESOURCE-SERVER.md §3d, isolation-table
 * row #3).
 */
async function getSessionStorage(authManager: AuthManager): ReturnType<typeof storageManager.getStorage> {
  const session = authManager.getSession();
  const sessionId = getEffectiveSessionId(authManager);
  return storageManager.getStorage(sessionId, session.userId, session.apiUrl);
}

/**
 * List tasks with optional filtering
 */
async function listTasks(
  args: TaskListingArgs,
  storage: Awaited<ReturnType<typeof storageManager.getStorage>>,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Execute the complete filtering workflow using the orchestrator.
    // authManager is threaded through for cross-project listing's
    // direct-REST GET /tasks strategy (RestCrossProjectFilteringStrategy).
    const filteringResult = await TaskFilteringOrchestrator.executeTaskFiltering(
      args,
      storage,
      {},
      authManager,
    );

    // Determine filtering method message
    let filteringMessage = '';
    if (args.filter) {
      if (filteringResult.metadata?.serverSideFilteringUsed) {
        filteringMessage = ' (filtered server-side)';
      } else if (filteringResult.metadata?.serverSideFilteringAttempted) {
        filteringMessage = ' (filtered client-side - server-side fallback)';
      } else {
        filteringMessage = ' (filtered client-side)';
      }
    }

    const taskCount = filteringResult.tasks?.length || 0;
    const response = createTaskResponse(
      'list-tasks',
      `Found ${taskCount} tasks${filteringMessage}`,
      { tasks: filteringResult.tasks || [] } as unknown as Parameters<typeof createTaskResponse>[2],
      {
        timestamp: new Date().toISOString(),
        count: taskCount,
        ...(filteringResult.metadata || {}),
      },
      undefined, // verbosity (ignored - using standard AORP)
      undefined, // useOptimizedFormat (ignored - using standard AORP)
      undefined, // useAorp (ignored - always using AORP)
      undefined, // aorpConfig (using auto-generated)
      args.sessionId
    );

    logger.debug('Tasks tool response', { subcommand: 'list', itemCount: taskCount });

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response.response),
        },
      ],
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }

    // Log the full error for debugging filter issues
    logger.error('Task list error:', {
      error: error instanceof Error ? error.message : String(error),
      filter: args.filter,
      filterId: args.filterId,
    });

    throw handleFetchError(error, 'list tasks');
  }
}

export function registerTasksTool(
  server: McpServer, 
  authManager: AuthManager, 
  clientFactory?: VikunjaClientFactory
): void {
  server.tool(
    'vikunja_tasks',
    withReadOnlyNote(
      'vikunja_tasks',
      'Manage tasks with comprehensive operations (create, update, delete, list, assign, attach/list/delete files, comment, bulk operations, set Kanban bucket, bulk set Kanban bucket, set position, lookup by per-project index, create/list subtasks, bulk create subtasks, duplicate, mark-read). ' +
        'download-attachment cannot deliver file bytes through MCP (no binary channel) — it returns the direct download URL and auth guidance instead. ' +
        'create-subtask is a composite (resolve parent -> create task -> relate -> verify) with opt-in atomic rollback via `atomic: true` (default best-effort — see docs/ENDPOINT-PLAYBOOK.md §5). ' +
        'bulk-create-subtasks creates several subtasks under the same parent in one call (resolves the parent once, then creates/relates each sequentially, per-subtask atomic rollback, honest partial reporting of which subtasks were created/related/failed). ' +
        'bulk-set-bucket moves several tasks into the same Kanban bucket in one call (resolves the project/view once, then applies each move sequentially, honest partial reporting of failedIds). ' +
        'duplicate copies a task (labels, assignees, attachments, reminders) into the same project (PUT /tasks/{taskID}/duplicate, no body). ' +
        'mark-read removes the current unread status entry for a task (POST /tasks/{projecttask}/read).',
    ),
    {
      subcommand: z.enum([
        'create',
        'get',
        'update',
        'delete',
        'list',
        'assign',
        'unassign',
        'list-assignees',
        'attach',
        'list-attachments',
        'get-attachment-info',
        'delete-attachment',
        'download-attachment',
        'comment',
        'bulk-create',
        'bulk-update',
        'bulk-delete',
        'relate',
        'unrelate',
        'relations',
        'add-reminder',
        'remove-reminder',
        'list-reminders',
        'apply-label',
        'remove-label',
        'list-labels',
        'set-bucket',
        'bulk-set-bucket',
        'set-position',
        'get-by-index',
        'create-subtask',
        'bulk-create-subtasks',
        'list-subtasks',
        'duplicate',
        'mark-read',
      ]),
      // Task creation/update fields
      title: z.string().optional(),
      description: z.string().optional(),
      projectId: z.number().optional(),
      dueDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      priority: z.number().min(0).max(5).optional(),
      percentDone: z.number().min(0).max(1).optional(),
      labels: z.array(z.number()).optional(),
      assignees: z.array(z.number()).optional(),
      // Kanban bucket fields (set-bucket subcommand).
      // z.coerce tolerates MCP clients whose cached tool schema predates
      // these params and therefore send them as strings over JSON-RPC.
      bucketId: z.coerce.number().optional(),
      viewId: z.coerce.number().optional(),
      // Task position fields (set-position subcommand). position is a
      // float64 per the API (see models.TaskPosition) - see docs on
      // spreading tasks between two positions - so it is not coerced to an
      // integer. projectViewId is auto-resolved from projectId + viewKind
      // when omitted, mirroring set-bucket's resolve-by-name friendliness.
      position: z.coerce.number().optional(),
      projectViewId: z.coerce.number().optional(),
      viewKind: z.enum(['list', 'gantt', 'table', 'kanban']).optional(),
      // By-index lookup field (get-by-index subcommand): the task's
      // human-facing per-project index (e.g. the "42" in "PROJ-42").
      index: z.coerce.number().optional(),
      // Recurring task fields
      repeatAfter: z.number().min(0).optional(),
      repeatMode: z.enum(['day', 'week', 'month', 'year']).optional(),
      // Query fields
      id: z.number().optional(),
      filter: z
        .string()
        .optional()
        .describe(
          'Filter query string (e.g. "priority >= 4 && dueDate < now+14d"). Fields use ' +
            'camelCase (dueDate, percentDone, startDate, endDate, doneAt, project, plus ' +
            'done/priority/assignees/labels/created/updated/title/description); ' +
            'snake_case aliases (due_date, percent_done, etc.) are also accepted and ' +
            'normalized automatically. Build one with vikunja_filters build/validate.',
        ),
      filterId: z.string().optional(),
      page: z.number().optional(),
      perPage: z.number().optional(),
      sort: z.string().optional(),
      search: z.string().optional(),
      // List specific filters
      allProjects: z.boolean().optional(),
      done: z.boolean().optional(),
      // GET /tasks query params honored for cross-project listing (direct
      // REST — see RestCrossProjectFilteringStrategy). Single-project
      // listing (ClientSideFilteringStrategy/ServerSideFilteringStrategy)
      // calls GET /projects/{id}/tasks, which never supported these extra
      // params, so they are silently unused in that case.
      orderBy: z.enum(['asc', 'desc']).optional(),
      filterTimezone: z.string().optional(),
      filterIncludeNulls: z.boolean().optional(),
      expand: z.array(z.enum(['subtasks', 'buckets', 'reactions', 'comments'])).optional(),
      // Comment fields
      comment: z.string().optional(),
      commentId: z.number().optional(),
      // Bulk operation fields
      taskIds: z.array(z.number()).optional(),
      field: z.string().optional(),
      value: z.unknown().optional(),
      tasks: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            dueDate: z.string().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            priority: z.number().min(0).max(5).optional(),
            labels: z.array(z.number()).optional(),
            assignees: z.array(z.number()).optional(),
            repeatAfter: z.number().min(0).optional(),
            repeatMode: z.enum(['day', 'week', 'month', 'year']).optional(),
          }),
        )
        .optional(),
      // Reminder fields
      reminderDate: z.string().optional(),
      // Vikunja's API has no reminder id — remove-reminder identifies the
      // reminder to remove by its reminderDate string and/or its zero-based
      // reminderIndex, both shown by list-reminders.
      reminderIndex: z.number().optional(),
      // Attach subcommand fields (filePath, fileContent, filename)
      ...attachSchemaFields,
      // Attachments read-side fields (list-attachments, get-attachment-info,
      // delete-attachment, download-attachment). page/perPage are shared
      // with the generic query fields above.
      attachmentId: z.number().optional(),
      previewSize: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
      // Add relation schema
      ...relationSchema,
      // Subtask composite fields (create-subtask, bulk-create-subtasks).
      // title/description/dueDate/priority/labels/assignees/bucketId are
      // shared with the generic create/set-bucket fields above.
      parentTaskId: z.number().optional(),
      // Opt into atomic rollback for create-subtask / bulk-create-subtasks
      // (default best-effort; bulk-create-subtasks applies it PER SUBTASK,
      // never across the batch) — see docs/ENDPOINT-PLAYBOOK.md §5.
      atomic: z.boolean().optional(),
      // bulk-create-subtasks: array of subtask specs, same per-item shape as
      // create-subtask's own fields.
      subtasks: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            dueDate: z.string().optional(),
            priority: z.number().min(0).max(5).optional(),
            labels: z.array(z.number()).optional(),
            assignees: z.array(z.number()).optional(),
            bucketId: z.coerce.number().optional(),
          }),
        )
        .optional(),
      // Session ID for AORP response tracking
      sessionId: z.string().optional(),
    },
    getToolAnnotations('vikunja_tasks'),
    async (args) => {
      try {
        logger.debug('Executing tasks tool', { subcommand: args.subcommand, args });

        // Check authentication with enhanced error message
        if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access task management features');
        }

        // Global read-only safety mode gate. 'comment' is dual-purpose
        // (creates a comment when text is supplied, otherwise lists
        // comments — see handleComment) so its effective classification
        // depends on whether `comment` text was actually provided.
        assertWriteAllowed(
          'vikunja_tasks',
          args.subcommand,
          args.subcommand === 'comment' ? (args.comment ? 'write' : 'read') : undefined,
        );

        // Set the client factory for this request if provided
        if (clientFactory) {
          await setGlobalClientFactory(clientFactory);
        }

        // Test client connection
        await getAuthManagerFromContext();

        switch (args.subcommand) {
          case 'list': {
            // Get session-scoped storage for filter operations (only when needed)
            const storage = await getSessionStorage(authManager);
            return listTasks(args as Parameters<typeof listTasks>[0], storage, authManager);
          }

          case 'create':
            return createTask(args as Parameters<typeof createTask>[0], authManager);

          case 'get':
            return getTask(args as Parameters<typeof getTask>[0], authManager);

          case 'update':
            return updateTask(args as Parameters<typeof updateTask>[0], authManager);

          case 'delete':
            return deleteTask(args as Parameters<typeof deleteTask>[0], authManager);

          case 'assign':
            return assignUsers(args as Parameters<typeof assignUsers>[0], authManager);

          case 'unassign':
            return unassignUsers(args as Parameters<typeof unassignUsers>[0], authManager);

          case 'list-assignees':
            return listAssignees(args as Parameters<typeof listAssignees>[0], authManager);

          case 'comment':
            return handleComment(args as Parameters<typeof handleComment>[0], authManager);

          case 'attach':
            return handleAttach(args as TaskAttachArgs, authManager);

          case 'list-attachments':
            return listAttachments(args as AttachmentSubcommandArgs, authManager);

          case 'get-attachment-info':
            return getAttachmentInfo(args as AttachmentSubcommandArgs, authManager);

          case 'delete-attachment':
            return deleteAttachment(args as AttachmentSubcommandArgs, authManager);

          case 'download-attachment':
            return downloadAttachment(args as AttachmentSubcommandArgs, authManager);

          case 'bulk-update':
            return bulkUpdateTasks(args as Parameters<typeof bulkUpdateTasks>[0], authManager);

          case 'bulk-delete':
            return bulkDeleteTasks(args as Parameters<typeof bulkDeleteTasks>[0], authManager);

          case 'bulk-create':
            return bulkCreateTasks(args as Parameters<typeof bulkCreateTasks>[0], authManager);

          // Handle relation subcommands
          case 'relate':
          case 'unrelate':
          case 'relations':
            return handleRelationSubcommands(
              {
                subcommand: args.subcommand,
                id: args.id,
                otherTaskId: args.otherTaskId,
                relationKind: args.relationKind,
              },
              authManager,
            );

          // Handle reminder operations
          case 'add-reminder':
            return addReminder(args as Parameters<typeof addReminder>[0], authManager);

          case 'remove-reminder':
            return removeReminder(args as Parameters<typeof removeReminder>[0], authManager);

          case 'list-reminders':
            return listReminders(args as Parameters<typeof listReminders>[0], authManager);
          case 'apply-label':
            return applyLabels(args as Parameters<typeof applyLabels>[0], authManager);

          case 'remove-label':
            return removeLabels(args as Parameters<typeof removeLabels>[0], authManager);

          case 'list-labels':
            return listTaskLabels(args as Parameters<typeof listTaskLabels>[0], authManager);

          case 'set-bucket':
            return setTaskBucket(args as Parameters<typeof setTaskBucket>[0], authManager);

          case 'bulk-set-bucket':
            return bulkSetTaskBucket(args as Parameters<typeof bulkSetTaskBucket>[0], authManager);

          case 'set-position':
            return setTaskPosition(args as Parameters<typeof setTaskPosition>[0], authManager);

          case 'get-by-index':
            return getTaskByIndex(args as Parameters<typeof getTaskByIndex>[0], authManager);

          case 'create-subtask':
            return createSubtask(args as Parameters<typeof createSubtask>[0], authManager);

          case 'bulk-create-subtasks':
            return bulkCreateSubtasks(args as Parameters<typeof bulkCreateSubtasks>[0], authManager);

          case 'list-subtasks':
            return listSubtasks(args as Parameters<typeof listSubtasks>[0], authManager);

          case 'duplicate':
            return duplicateTask(args as Parameters<typeof duplicateTask>[0], authManager);

          case 'mark-read':
            return markTaskRead(args as Parameters<typeof markTaskRead>[0], authManager);

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${args.subcommand as string}`,
            );
        }
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Task operation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
