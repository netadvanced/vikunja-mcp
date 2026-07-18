/**
 * Helper for replacing the full label set of a task.
 */

import type { VikunjaClient } from 'node-vikunja';
import type { components } from '../types/generated/vikunja-openapi';
import { getAuthManagerFromContext } from '../client';
import { vikunjaRestRequest } from './vikunja-rest';

/** `models.LabelTaskBulk` per the OpenAPI spec: `{ labels: models.Label[] }`. */
type LabelTaskBulk = components['schemas']['models.LabelTaskBulk'];

/**
 * Replace all labels on a task via `POST /tasks/{taskID}/labels/bulk`.
 *
 * node-vikunja types this endpoint's body as `{ label_ids: number[] }`, but
 * current Vikunja silently ignores that field: it responds `201` and persists
 * nothing. The real request body, per the vendored OpenAPI spec's
 * `models.LabelTaskBulk` schema, is `{ labels: [{ id }, ...] }` — this now
 * calls the endpoint directly via `vikunjaRestRequest` rather than casting
 * past node-vikunja's drifted `updateTaskLabels` type.
 *
 * The endpoint has replace semantics — the task's labels become exactly
 * `labelIds` (passing `[]` clears every label).
 *
 * @param client - Unused. Retained (rather than removed) purely for call-site
 *   compatibility: `setTaskLabels` is called from task CRUD services
 *   (`src/tools/tasks/crud/TaskUpdateService.ts`,
 *   `src/services/TaskCreationService.ts`) and other tools
 *   (`src/tools/templates.ts`, `src/tools/tasks/bulk-operations-simplified.ts`)
 *   that are out of scope for this task-sub-resource migration and still
 *   only have a `VikunjaClient` on hand, not an `AuthManager`. The REST
 *   session is instead recovered via `getAuthManagerFromContext()`, which
 *   reads the same active session those callers already authenticated
 *   through `getClientFromContext()`.
 */
export async function setTaskLabels(
  _client: VikunjaClient,
  taskId: number,
  labelIds: number[],
): Promise<void> {
  const authManager = await getAuthManagerFromContext();
  const body: LabelTaskBulk = { labels: labelIds.map((id) => ({ id })) };
  try {
    await vikunjaRestRequest(authManager, 'POST', `/tasks/${taskId}/labels/bulk`, body);
  } catch (error) {
    // Unwrap the MCPError vikunjaRestRequest throws back into a plain
    // Error (preserving `.message` and, if present, the `.status` that
    // vikunja-rest.ts attaches for HTTP-response failures). Every existing
    // caller of setTaskLabels (TaskUpdateService, TaskCreationService,
    // bulk-operations-simplified, templates — all out of scope for this
    // sub-resource migration) branches on `instanceof MCPError` to
    // distinguish "already a structured MCP error" from "a raw node-vikunja
    // failure to wrap myself", the same way node-vikunja's own rejections
    // always arrived as plain Errors. Letting vikunjaRestRequest's MCPError
    // through unchanged would silently skip that wrapping (e.g.
    // bulk-operations-simplified's `isLabelAssigneeError` marking), turning
    // a specific "label update failed: <reason>" message into a generic
    // "Bulk create failed" one.
    if (error instanceof Error) {
      const status = (error as { status?: unknown }).status;
      const plainError = new Error(error.message);
      if (typeof status === 'number') {
        (plainError as Error & { status: number }).status = status;
      }
      throw plainError;
    }
    throw error;
  }
}
