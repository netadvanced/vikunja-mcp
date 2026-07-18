/**
 * Helper for replacing the full label set of a task.
 */

import type { components } from '../types/generated/vikunja-openapi';
import type { AuthManager } from '../auth/AuthManager';
import { vikunjaRestRequest } from './vikunja-rest';

/** `models.LabelTaskBulk` per the OpenAPI spec: `{ labels: models.Label[] }`. */
type LabelTaskBulk = components['schemas']['models.LabelTaskBulk'];

/**
 * Replace all labels on a task via `POST /tasks/{taskID}/labels/bulk`.
 *
 * legacy client types this endpoint's body as `{ label_ids: number[] }`, but
 * current Vikunja silently ignores that field: it responds `201` and persists
 * nothing. The real request body, per the vendored OpenAPI spec's
 * `models.LabelTaskBulk` schema, is `{ labels: [{ id }, ...] }` — this now
 * calls the endpoint directly via `vikunjaRestRequest` rather than casting
 * past the legacy client's drifted `updateTaskLabels` type.
 *
 * The endpoint has replace semantics — the task's labels become exactly
 * `labelIds` (passing `[]` clears every label).
 *
 * @param authManager - Active auth manager holding the session credentials.
 */
export async function setTaskLabels(
  authManager: AuthManager,
  taskId: number,
  labelIds: number[],
): Promise<void> {
  const body: LabelTaskBulk = { labels: labelIds.map((id) => ({ id })) };
  try {
    await vikunjaRestRequest(authManager, 'POST', `/tasks/${taskId}/labels/bulk`, body);
  } catch (error) {
    // Unwrap the MCPError vikunjaRestRequest throws back into a plain
    // Error (preserving `.message` and, if present, the `.status` that
    // vikunja-rest.ts attaches for HTTP-response failures). Every caller of
    // setTaskLabels (TaskUpdateService, TaskCreationService,
    // bulk-operations-simplified, templates) branches on `instanceof MCPError`
    // to distinguish "already a structured MCP error" from "a raw transport
    // failure to wrap myself". Letting vikunjaRestRequest's MCPError through
    // unchanged would silently skip that wrapping (e.g.
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
