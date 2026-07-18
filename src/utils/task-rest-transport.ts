/**
 * Shared direct-REST transport for reading/writing a full task object.
 *
 * `src/tools/tasks/reminders.ts` needs this because Vikunja has no dedicated
 * reminder sub-resource endpoint — reminders "ride on" the full task-update
 * endpoint (`POST /tasks/{id}`, a full-model-replace: fetch → merge
 * `reminders` → POST the whole task back, per the same pattern documented
 * for `buildProjectUpdatePayload` in docs/ENDPOINT-PLAYBOOK.md §4). That
 * endpoint is also task CRUD's own update endpoint
 * (`src/tools/tasks/crud/TaskUpdateService.ts`), which this Wave D
 * sub-resource migration must not edit — so this is a standalone helper
 * rather than a change to that service, per the playbook's guidance to add
 * a new shared transport file when one is genuinely needed.
 */

import type { AuthManager } from '../auth/AuthManager';
import { vikunjaRestRequest } from './vikunja-rest';
import type { components } from '../types/generated/vikunja-openapi';

/** `models.Task` per the OpenAPI spec. */
export type VikunjaRestTask = components['schemas']['models.Task'];

/** `GET /tasks/{id}`. */
export async function getTaskViaRest(
  authManager: AuthManager,
  taskId: number,
): Promise<VikunjaRestTask> {
  return vikunjaRestRequest<VikunjaRestTask>(authManager, 'GET', `/tasks/${taskId}`);
}

/**
 * `POST /tasks/{id}` — full-model-replace. Callers must send the complete
 * desired task object (typically the result of fetching via
 * `getTaskViaRest`, spreading it, then overlaying only the changed fields),
 * not a bare partial body.
 */
export async function updateTaskViaRest(
  authManager: AuthManager,
  taskId: number,
  task: VikunjaRestTask,
): Promise<VikunjaRestTask> {
  return vikunjaRestRequest<VikunjaRestTask>(authManager, 'POST', `/tasks/${taskId}`, task);
}
