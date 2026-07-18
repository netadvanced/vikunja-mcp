/**
 * Project view operations
 *
 * Implements `list-views`, `get-view`, `create-view`, `update-view`,
 * `delete-view`, and the `set-done-bucket` composite, against Vikunja's
 * project view endpoints (`/projects/{project}/views[/{id}]`). legacy client
 * has no support for project views at all, so — like `buckets.ts` — this
 * calls the Vikunja REST API directly via the shared `vikunja-rest` helper.
 *
 * `POST /projects/{project}/views/{id}` replaces the entire ProjectView
 * resource (see docs/ENDPOINT-PLAYBOOK.md §4), so `update-view` and
 * `set-done-bucket` both fetch the current view first and merge requested
 * changes onto it (`buildViewUpdatePayload`) rather than sending a bare
 * partial object — the same fetch-merge-POST pattern as
 * `buildProjectUpdatePayload` in `crud.ts`.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest, resolveKanbanViewId } from '../../utils/vikunja-rest';
import type { components } from '../../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json) — see
// docs/API-SPEC.md. All fields are optional per the spec.
type VikunjaProjectView = components['schemas']['models.ProjectView'];

type ViewKind = 'list' | 'gantt' | 'table' | 'kanban';
type BucketConfigurationMode = 'none' | 'manual' | 'filter';

export interface ListViewsArgs {
  /** Project whose views should be listed. */
  id?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface GetViewArgs {
  /** Project the view belongs to. */
  id?: number;
  /** Id of the view to fetch. */
  viewId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface CreateViewArgs {
  /** Project the new view should belong to. */
  id?: number;
  /** Title of the new view. */
  title?: string;
  /** Kind of view to create (`list`, `gantt`, `table`, or `kanban`). */
  viewKind?: ViewKind;
  /** Bucket configuration mode. Only meaningful for kanban-style views. */
  bucketConfigurationMode?: BucketConfigurationMode;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface UpdateViewArgs {
  /** Project the view belongs to. */
  id?: number;
  /** Id of the view to update. */
  viewId?: number;
  /** New title, if changing. */
  title?: string;
  /** New view kind, if changing. */
  viewKind?: ViewKind;
  /** New bucket configuration mode, if changing. */
  bucketConfigurationMode?: BucketConfigurationMode;
  /** New done-bucket id, if changing. Also settable via `set-done-bucket`. */
  doneBucketId?: number;
  /** New default-bucket id, if changing. */
  defaultBucketId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface DeleteViewArgs {
  /** Project the view belongs to. */
  id?: number;
  /** Id of the view to delete. */
  viewId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface SetDoneBucketArgs {
  /** Project whose Kanban view's done bucket should be set. */
  id?: number;
  /** Optional Kanban view id. Auto-resolved from the project when omitted. */
  viewId?: number;
  /** Id of the bucket that should become the done bucket. */
  bucketId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

/**
 * Builds a project view update payload by merging the current view with
 * requested field changes, so fields the caller didn't mention survive the
 * full-model-replace `POST /projects/{project}/views/{id}` round trip.
 */
export function buildViewUpdatePayload(
  currentView: VikunjaProjectView,
  updates: {
    title?: string;
    viewKind?: ViewKind;
    bucketConfigurationMode?: BucketConfigurationMode;
    doneBucketId?: number;
    defaultBucketId?: number;
  },
): VikunjaProjectView {
  return {
    ...currentView,
    ...(updates.title !== undefined && { title: updates.title.trim() }),
    ...(updates.viewKind !== undefined && { view_kind: updates.viewKind }),
    ...(updates.bucketConfigurationMode !== undefined && {
      bucket_configuration_mode: updates.bucketConfigurationMode,
    }),
    ...(updates.doneBucketId !== undefined && { done_bucket_id: updates.doneBucketId }),
    ...(updates.defaultBucketId !== undefined && { default_bucket_id: updates.defaultBucketId }),
  };
}

function viewSummary(view: VikunjaProjectView): Record<string, unknown> {
  return {
    id: view.id,
    title: view.title,
    viewKind: view.view_kind,
    position: view.position,
    bucketConfigurationMode: view.bucket_configuration_mode,
    defaultBucketId: view.default_bucket_id,
    doneBucketId: view.done_bucket_id,
  };
}

/**
 * Lists the views of a project.
 */
export async function listViews(
  args: ListViewsArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for list-views operation');
  }
  validateId(args.id, 'id');

  const views = await vikunjaRestRequest<VikunjaProjectView[]>(
    authManager,
    'GET',
    `/projects/${args.id}/views`,
  );
  const viewList = Array.isArray(views) ? views : [];

  const response = createStandardResponse(
    'list-views',
    `Found ${viewList.length} views for project ${args.id}`,
    {
      projectId: args.id,
      views: viewList.map(viewSummary),
    },
    {
      timestamp: new Date().toISOString(),
      count: viewList.length,
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Gets a single project view by id.
 */
export async function getView(
  args: GetViewArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for get-view operation');
  }
  if (args.viewId === undefined || args.viewId === null) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'View id is required for get-view operation');
  }
  validateId(args.id, 'id');
  validateId(args.viewId, 'viewId');

  const view = await vikunjaRestRequest<VikunjaProjectView>(
    authManager,
    'GET',
    `/projects/${args.id}/views/${args.viewId}`,
  );

  const response = createStandardResponse(
    'get-view',
    `Retrieved view ${args.viewId} of project ${args.id}`,
    { projectId: args.id, view: viewSummary(view) },
    { timestamp: new Date().toISOString() },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Creates a new view on a project.
 */
export async function createView(
  args: CreateViewArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for create-view operation');
  }
  if (!args.title || args.title.trim() === '') {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'title is required for create-view operation');
  }
  if (!args.viewKind) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'viewKind is required for create-view operation');
  }
  validateId(args.id, 'id');

  const body: VikunjaProjectView = {
    title: args.title.trim(),
    view_kind: args.viewKind,
  };
  if (args.bucketConfigurationMode !== undefined) {
    body.bucket_configuration_mode = args.bucketConfigurationMode;
  }

  const view = await vikunjaRestRequest<VikunjaProjectView>(
    authManager,
    'PUT',
    `/projects/${args.id}/views`,
    body,
  );

  const response = createStandardResponse(
    'create-view',
    `View "${view.title ?? args.title}" created on project ${args.id}`,
    { projectId: args.id, view: viewSummary(view) },
    {
      timestamp: new Date().toISOString(),
      affectedFields: ['title', 'view_kind'],
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Updates a project view. `POST /projects/{project}/views/{id}` is a
 * full-model-replace endpoint, so the current view is fetched first and
 * merged with the requested changes (see `buildViewUpdatePayload`).
 */
export async function updateView(
  args: UpdateViewArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for update-view operation');
  }
  if (args.viewId === undefined || args.viewId === null) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'View id is required for update-view operation');
  }
  validateId(args.id, 'id');
  validateId(args.viewId, 'viewId');

  const hasUpdateFields =
    args.title !== undefined ||
    args.viewKind !== undefined ||
    args.bucketConfigurationMode !== undefined ||
    args.doneBucketId !== undefined ||
    args.defaultBucketId !== undefined;
  if (!hasUpdateFields) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'No fields to update provided for update-view operation');
  }
  if (args.doneBucketId !== undefined) validateId(args.doneBucketId, 'doneBucketId');
  if (args.defaultBucketId !== undefined) validateId(args.defaultBucketId, 'defaultBucketId');

  const currentView = await vikunjaRestRequest<VikunjaProjectView>(
    authManager,
    'GET',
    `/projects/${args.id}/views/${args.viewId}`,
  );

  const fieldUpdates: {
    title?: string;
    viewKind?: ViewKind;
    bucketConfigurationMode?: BucketConfigurationMode;
    doneBucketId?: number;
    defaultBucketId?: number;
  } = {};
  if (args.title !== undefined) fieldUpdates.title = args.title;
  if (args.viewKind !== undefined) fieldUpdates.viewKind = args.viewKind;
  if (args.bucketConfigurationMode !== undefined) {
    fieldUpdates.bucketConfigurationMode = args.bucketConfigurationMode;
  }
  if (args.doneBucketId !== undefined) fieldUpdates.doneBucketId = args.doneBucketId;
  if (args.defaultBucketId !== undefined) fieldUpdates.defaultBucketId = args.defaultBucketId;

  const payload = buildViewUpdatePayload(currentView, fieldUpdates);

  const updatedView = await vikunjaRestRequest<VikunjaProjectView>(
    authManager,
    'POST',
    `/projects/${args.id}/views/${args.viewId}`,
    payload,
  );

  const response = createStandardResponse(
    'update-view',
    `View ${args.viewId} of project ${args.id} updated`,
    { projectId: args.id, view: viewSummary(updatedView) },
    {
      timestamp: new Date().toISOString(),
      affectedFields: Object.keys(fieldUpdates),
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Deletes a project view.
 */
export async function deleteView(
  args: DeleteViewArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for delete-view operation');
  }
  if (args.viewId === undefined || args.viewId === null) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'View id is required for delete-view operation');
  }
  validateId(args.id, 'id');
  validateId(args.viewId, 'viewId');

  await vikunjaRestRequest(authManager, 'DELETE', `/projects/${args.id}/views/${args.viewId}`);

  const response = createStandardResponse(
    'delete-view',
    `View ${args.viewId} of project ${args.id} deleted`,
    { deleted: true, projectId: args.id, viewId: args.viewId },
    { timestamp: new Date().toISOString() },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Composite: sets a Kanban view's done bucket.
 *
 * `models.Bucket` has no `is_done_bucket` field of its own (see
 * docs/API_NOTES.md "Kanban 'Done' Bucket") — the done bucket is a property
 * of the ProjectView (`done_bucket_id`), not the bucket. This is the only
 * way to *set* it (list-buckets can only read it). Steps: resolve the
 * project's Kanban view (or use an explicit `viewId`), fetch-merge-POST the
 * `done_bucket_id` change onto it, then verify the response reflects the
 * requested bucket before reporting success.
 */
export async function setDoneBucket(
  args: SetDoneBucketArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for set-done-bucket operation');
  }
  if (args.bucketId === undefined || args.bucketId === null) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'bucketId is required for set-done-bucket operation',
    );
  }
  validateId(args.id, 'id');
  validateId(args.bucketId, 'bucketId');
  if (args.viewId !== undefined) validateId(args.viewId, 'viewId');

  const viewId =
    args.viewId !== undefined ? args.viewId : await resolveKanbanViewId(authManager, args.id);

  const currentView = await vikunjaRestRequest<VikunjaProjectView>(
    authManager,
    'GET',
    `/projects/${args.id}/views/${viewId}`,
  );

  const payload = buildViewUpdatePayload(currentView, { doneBucketId: args.bucketId });

  const updatedView = await vikunjaRestRequest<VikunjaProjectView>(
    authManager,
    'POST',
    `/projects/${args.id}/views/${viewId}`,
    payload,
  );

  // Verify-then-report: the response's done_bucket_id must reflect the
  // requested bucket before this is reported as a success (ENDPOINT-PLAYBOOK
  // §1 "verify-then-apply").
  if (updatedView.done_bucket_id !== args.bucketId) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to set done bucket on view ${viewId} of project ${args.id}: expected done_bucket_id ${args.bucketId}, server reports ${String(
        updatedView.done_bucket_id,
      )}`,
    );
  }

  const response = createStandardResponse(
    'set-done-bucket',
    `Bucket ${args.bucketId} set as the done bucket for view ${viewId} of project ${args.id}`,
    { projectId: args.id, viewId, doneBucketId: args.bucketId, view: viewSummary(updatedView) },
    {
      timestamp: new Date().toISOString(),
      affectedFields: ['done_bucket_id'],
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}
