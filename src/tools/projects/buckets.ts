/**
 * Project Kanban bucket operations
 *
 * Implements `list-buckets`, `create-bucket`, `update-bucket`,
 * `delete-bucket`, and `list-view-tasks` (per-view task listing in real
 * Kanban card order). `list-buckets` lets callers resolve a bucket by name
 * (e.g. "Doing") instead of hard-coding numeric bucket ids; `update-bucket`
 * and `delete-bucket` extend that convenience by accepting a `bucketTitle`
 * wherever a `bucketId` is otherwise required, resolved internally via a
 * bucket list lookup — the same resolve-by-name-internally shape as
 * `setTaskBucket` (`src/tools/tasks/buckets.ts`), Wave D's exemplar for
 * "don't make the caller pre-fetch ids they shouldn't have to know"
 * (docs/ENDPOINT-PLAYBOOK.md §1).
 *
 * legacy client does not expose the Kanban view endpoints, so this calls the
 * Vikunja REST API directly via the shared `vikunja-rest` helper.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest, resolveKanbanView, resolveKanbanViewId } from '../../utils/vikunja-rest';
import type { components } from '../../types/generated/vikunja-openapi';

export interface ListBucketsArgs {
  /** Project whose Kanban buckets should be listed. */
  id?: number;
  /** Optional Kanban view id. Auto-resolved from the project when omitted. */
  viewId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface CreateBucketArgs {
  /** Project the new bucket should belong to. */
  id?: number;
  /** Optional Kanban view id. Auto-resolved from the project when omitted. */
  viewId?: number;
  /** Title of the new bucket. */
  title?: string;
  /** Optional max task count for the bucket (0 = unlimited). */
  limit?: number;
  /**
   * Optional lane-order position. Vikunja positions are float64s — to slot a
   * bucket between two existing ones, pick any value strictly between their
   * positions (fractions are fine). Omitted = the server appends it last.
   */
  position?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

/** Identifies an existing bucket by either its numeric id or its title. */
interface BucketRef {
  bucketId?: number;
  bucketTitle?: string;
}

export interface UpdateBucketArgs extends BucketRef {
  /** Project the bucket belongs to. */
  id?: number;
  /** Optional Kanban view id. Auto-resolved from the project when omitted. */
  viewId?: number;
  /** New title, if renaming. */
  title?: string;
  /** New max task count, if changing (0 = unlimited). */
  limit?: number;
  /** New lane-order position, if moving (see `CreateBucketArgs.position`). */
  position?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface DeleteBucketArgs extends BucketRef {
  /** Project the bucket belongs to. */
  id?: number;
  /** Optional Kanban view id. Auto-resolved from the project when omitted. */
  viewId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

export interface ListViewTasksArgs {
  /** Project whose view tasks should be listed. */
  id?: number;
  /** Optional view id. Auto-resolved to the Kanban view when omitted. */
  viewId?: number;
  /** Page number for pagination. */
  page?: number;
  /** Items per page. */
  perPage?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json) —
// see docs/API-SPEC.md. All fields are optional per the spec (the API does
// not mark any Bucket property `required`), which matches the actual GET
// response shape more accurately than a hand-rolled interface would.
type VikunjaBucket = components['schemas']['models.Bucket'];

/** Non-negative integer check for `limit` (0 is a valid "unlimited" value,
 * so this can't reuse `validateId`, which rejects 0). */
function validateNonNegativeInt(value: number, fieldName: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, `${fieldName} must be a non-negative integer`);
  }
}

/** Non-negative finite number check for `position` — Vikunja positions are
 * float64s, so fractional values are valid (and are how you slot a bucket
 * between two neighbors). */
function validateNonNegativeNumber(value: number, fieldName: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, `${fieldName} must be a non-negative number`);
  }
}

/**
 * Fetches the buckets of a project's view.
 *
 * Exported so callers that need the raw, structured bucket list — not
 * `listBuckets`'s formatted MCP response — can reuse the exact same fetch
 * (e.g. `setupKanban`, `src/tools/projects/kanban-setup.ts`, which needs
 * numeric bucket ids to place tasks after resolving each requested column).
 */
export async function fetchBuckets(
  authManager: AuthManager,
  projectId: number,
  viewId: number,
): Promise<VikunjaBucket[]> {
  const buckets = await vikunjaRestRequest<VikunjaBucket[]>(
    authManager,
    'GET',
    `/projects/${projectId}/views/${viewId}/buckets`,
  );
  return Array.isArray(buckets) ? buckets : [];
}

/**
 * Creates a bucket and returns the raw, structured `VikunjaBucket` (not a
 * formatted MCP response). This is the exact request `createBucket` (the
 * `create-bucket` subcommand handler) sends — extracted so `setupKanban`
 * can reuse it directly and get the created bucket's numeric id back for
 * task placement, without parsing a markdown-formatted response.
 */
export async function createBucketRaw(
  authManager: AuthManager,
  projectId: number,
  viewId: number,
  fields: { title: string; limit?: number; position?: number },
): Promise<VikunjaBucket> {
  const body: VikunjaBucket = { title: fields.title };
  if (fields.limit !== undefined) body.limit = fields.limit;
  if (fields.position !== undefined) body.position = fields.position;
  return vikunjaRestRequest<VikunjaBucket>(
    authManager,
    'PUT',
    `/projects/${projectId}/views/${viewId}/buckets`,
    body,
  );
}

/**
 * Updates a bucket (fetch-merge-POST already applied by the caller via
 * `current`) and returns the raw, structured `VikunjaBucket`. This is the
 * exact request `updateBucket` (the `update-bucket` subcommand handler)
 * sends — extracted so `setupKanban` can reuse it directly (e.g. to rename
 * a leftover default bucket to a requested column name, or to pin a
 * reused bucket's `position` to enforce column order) without parsing a
 * markdown-formatted response.
 */
export async function updateBucketRaw(
  authManager: AuthManager,
  projectId: number,
  viewId: number,
  current: VikunjaBucket,
  fields: { title?: string; limit?: number; position?: number },
): Promise<VikunjaBucket> {
  const payload: VikunjaBucket = {
    ...current,
    ...(fields.title !== undefined && { title: fields.title }),
    ...(fields.limit !== undefined && { limit: fields.limit }),
    ...(fields.position !== undefined && { position: fields.position }),
  };
  return vikunjaRestRequest<VikunjaBucket>(
    authManager,
    'POST',
    `/projects/${projectId}/views/${viewId}/buckets/${current.id}`,
    payload,
  );
}

/**
 * Builds a `BucketRef` without explicit `undefined` keys, so it satisfies
 * `exactOptionalPropertyTypes` when the caller's own `bucketId`/`bucketTitle`
 * args may themselves be `undefined`.
 */
function toBucketRef(bucketId: number | undefined, bucketTitle: string | undefined): BucketRef {
  const ref: BucketRef = {};
  if (bucketId !== undefined) ref.bucketId = bucketId;
  if (bucketTitle !== undefined) ref.bucketTitle = bucketTitle;
  return ref;
}

/**
 * Resolves a bucket reference (`bucketId` or `bucketTitle`) against an
 * already-fetched bucket list. `bucketId` wins when both are supplied.
 */
function resolveBucketFromList(
  buckets: VikunjaBucket[],
  ref: BucketRef,
  projectId: number,
): VikunjaBucket {
  if (ref.bucketId !== undefined) {
    const match = buckets.find((bucket) => bucket.id === ref.bucketId);
    if (!match) {
      throw new MCPError(
        ErrorCode.NOT_FOUND,
        `Bucket ${ref.bucketId} not found in project ${projectId}'s Kanban view`,
      );
    }
    return match;
  }
  if (ref.bucketTitle !== undefined && ref.bucketTitle.trim() !== '') {
    const match = buckets.find((bucket) => bucket.title === ref.bucketTitle);
    if (!match) {
      throw new MCPError(
        ErrorCode.NOT_FOUND,
        `No bucket titled "${ref.bucketTitle}" found in project ${projectId}'s Kanban view`,
      );
    }
    return match;
  }
  throw new MCPError(
    ErrorCode.VALIDATION_ERROR,
    'bucketId or bucketTitle is required — pass the numeric bucketId from vikunja_projects ' +
      'list-buckets, or the bucket\'s display name as bucketTitle (e.g. "Doing") to resolve it ' +
      'by name instead.',
  );
}

/**
 * Lists the Kanban buckets of a project.
 *
 * @param args - Project id and optional view id
 * @param authManager - Active auth manager holding session credentials
 * @returns MCP response containing the project's Kanban buckets
 */
export async function listBuckets(
  args: ListBucketsArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'id (or projectId, accepted as an alias) is required for list-buckets operation — ' +
        'the project whose Kanban buckets to list; get it from vikunja_projects list.',
    );
  }
  validateId(args.id, 'id');
  if (args.viewId !== undefined) validateId(args.viewId, 'viewId');

  // models.Bucket has no is_done_bucket field of its own — the "done" bucket
  // is designated by done_bucket_id on the ProjectView. When the view is
  // auto-resolved we already have that view (and its done_bucket_id) for
  // free; when the caller passes an explicit viewId we don't have the view
  // data and won't spend an extra request fetching it just for this, so
  // isDoneBucket conservatively falls back to false in that case.
  let viewId: number;
  let doneBucketId: number | undefined;
  if (args.viewId !== undefined) {
    viewId = args.viewId;
  } else {
    const kanbanView = await resolveKanbanView(authManager, args.id);
    viewId = kanbanView.id;
    doneBucketId = kanbanView.done_bucket_id;
  }

  const buckets = await vikunjaRestRequest<VikunjaBucket[]>(
    authManager,
    'GET',
    `/projects/${args.id}/views/${viewId}/buckets`,
  );
  const bucketList = Array.isArray(buckets) ? buckets : [];

  const response = createStandardResponse(
    'list-buckets',
    `Found ${bucketList.length} buckets in the Kanban view of project ${args.id}`,
    {
      projectId: args.id,
      viewId,
      buckets: bucketList.map((bucket) => ({
        id: bucket.id,
        title: bucket.title,
        position: bucket.position,
        limit: bucket.limit,
        isDoneBucket: doneBucketId !== undefined && bucket.id === doneBucketId,
      })),
    },
    {
      timestamp: new Date().toISOString(),
      count: bucketList.length,
    },
    args.sessionId,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: formatAorpAsMarkdown(response),
      },
    ],
  };
}

/**
 * Creates a new Kanban bucket (column) on a project's Kanban view.
 */
export async function createBucket(
  args: CreateBucketArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'id (or projectId, accepted as an alias) is required for create-bucket operation — ' +
        'the project to add the bucket to; get it from vikunja_projects list.',
    );
  }
  if (!args.title || args.title.trim() === '') {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'title is required for create-bucket operation');
  }
  validateId(args.id, 'id');
  if (args.viewId !== undefined) validateId(args.viewId, 'viewId');
  if (args.limit !== undefined) validateNonNegativeInt(args.limit, 'limit');
  if (args.position !== undefined) validateNonNegativeNumber(args.position, 'position');

  const viewId =
    args.viewId !== undefined ? args.viewId : await resolveKanbanViewId(authManager, args.id);

  const bucketFields: { title: string; limit?: number; position?: number } = { title: args.title.trim() };
  if (args.limit !== undefined) bucketFields.limit = args.limit;
  if (args.position !== undefined) bucketFields.position = args.position;

  const bucket = await createBucketRaw(authManager, args.id, viewId, bucketFields);

  const affectedFields = ['title'];
  if (args.limit !== undefined) affectedFields.push('limit');
  if (args.position !== undefined) affectedFields.push('position');

  const response = createStandardResponse(
    'create-bucket',
    `Bucket "${bucket.title ?? args.title}" created in the Kanban view of project ${args.id}`,
    {
      projectId: args.id,
      viewId,
      bucket: { id: bucket.id, title: bucket.title, position: bucket.position, limit: bucket.limit },
    },
    {
      timestamp: new Date().toISOString(),
      affectedFields,
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Updates an existing Kanban bucket. `POST
 * /projects/{projectID}/views/{view}/buckets/{bucketID}` replaces the whole
 * bucket resource, so the current bucket is fetched first (via the bucket
 * list, which also resolves `bucketTitle` when `bucketId` is omitted) and
 * merged with the requested changes.
 */
export async function updateBucket(
  args: UpdateBucketArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'id (or projectId, accepted as an alias) is required for update-bucket operation — ' +
        'the project whose bucket to update (also pass bucketId or bucketTitle to identify ' +
        'the bucket itself); get the project id from vikunja_projects list.',
    );
  }
  validateId(args.id, 'id');
  if (args.viewId !== undefined) validateId(args.viewId, 'viewId');
  if (args.bucketId !== undefined) validateId(args.bucketId, 'bucketId');

  const hasUpdateFields =
    args.title !== undefined || args.limit !== undefined || args.position !== undefined;
  if (!hasUpdateFields) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'No fields to update provided for update-bucket operation',
    );
  }
  if (args.limit !== undefined) validateNonNegativeInt(args.limit, 'limit');
  if (args.position !== undefined) validateNonNegativeNumber(args.position, 'position');

  const viewId =
    args.viewId !== undefined ? args.viewId : await resolveKanbanViewId(authManager, args.id);

  const buckets = await fetchBuckets(authManager, args.id, viewId);
  const current = resolveBucketFromList(
    buckets,
    toBucketRef(args.bucketId, args.bucketTitle),
    args.id,
  );

  const updateFields: { title?: string; limit?: number; position?: number } = {};
  if (args.title !== undefined) updateFields.title = args.title.trim();
  if (args.limit !== undefined) updateFields.limit = args.limit;
  if (args.position !== undefined) updateFields.position = args.position;

  const updated = await updateBucketRaw(authManager, args.id, viewId, current, updateFields);

  const affectedFields: string[] = [];
  if (args.title !== undefined) affectedFields.push('title');
  if (args.limit !== undefined) affectedFields.push('limit');
  if (args.position !== undefined) affectedFields.push('position');

  const response = createStandardResponse(
    'update-bucket',
    `Bucket ${current.id} in the Kanban view of project ${args.id} updated`,
    {
      projectId: args.id,
      viewId,
      bucket: {
        id: updated.id,
        title: updated.title,
        position: updated.position,
        limit: updated.limit,
      },
    },
    {
      timestamp: new Date().toISOString(),
      affectedFields,
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Deletes a Kanban bucket. Does not delete the tasks in it — Vikunja
 * dissociates them from the bucket instead.
 */
export async function deleteBucket(
  args: DeleteBucketArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'id (or projectId, accepted as an alias) is required for delete-bucket operation — ' +
        'the project whose bucket to delete; get it from vikunja_projects list.',
    );
  }
  validateId(args.id, 'id');
  if (args.viewId !== undefined) validateId(args.viewId, 'viewId');
  if (args.bucketId !== undefined) validateId(args.bucketId, 'bucketId');

  const viewId =
    args.viewId !== undefined ? args.viewId : await resolveKanbanViewId(authManager, args.id);

  const buckets = await fetchBuckets(authManager, args.id, viewId);
  const current = resolveBucketFromList(
    buckets,
    toBucketRef(args.bucketId, args.bucketTitle),
    args.id,
  );

  await vikunjaRestRequest(
    authManager,
    'DELETE',
    `/projects/${args.id}/views/${viewId}/buckets/${current.id}`,
  );

  const response = createStandardResponse(
    'delete-bucket',
    `Bucket ${current.id} ("${current.title ?? ''}") deleted from the Kanban view of project ${args.id}`,
    { deleted: true, projectId: args.id, viewId, bucketId: current.id },
    { timestamp: new Date().toISOString() },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}

/**
 * Lists the tasks of a project view in their real server-side order
 * (`GET /projects/{id}/views/{view}/tasks`), with pagination.
 *
 * The view id is auto-resolved to the project's Kanban view when omitted,
 * matching `list-buckets`'s resolution behavior — this endpoint is most
 * useful for Kanban views, where it returns cards in actual board order
 * (unlike the generic task-listing endpoints used by `vikunja_tasks list`).
 *
 * The OpenAPI spec declares this endpoint's response as a flat `Task[]` for
 * every view kind, but Vikunja's own endpoint description says a Kanban
 * view returns "a list of buckets containing the tasks" instead — i.e. the
 * real Kanban response is bucket-shaped (each item carries a nested `tasks`
 * array), not task-shaped. Since this can't be verified against a live
 * server from spec text alone, the response is passed through unmodified so
 * callers can inspect the actual shape (check for a `tasks` field on each
 * item) rather than have it silently coerced into an assumption that may be
 * wrong. See docs/API_NOTES.md "Per-view task listing".
 */
export async function listViewTasks(
  args: ListViewTasksArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'Project id is required for list-view-tasks operation',
    );
  }
  validateId(args.id, 'id');
  if (args.viewId !== undefined) validateId(args.viewId, 'viewId');
  if (args.page !== undefined) validateId(args.page, 'page');
  if (args.perPage !== undefined) validateId(args.perPage, 'perPage');

  const viewId =
    args.viewId !== undefined ? args.viewId : await resolveKanbanViewId(authManager, args.id);

  const query = new URLSearchParams();
  if (args.page !== undefined) query.set('page', String(args.page));
  if (args.perPage !== undefined) query.set('per_page', String(args.perPage));
  const queryString = query.toString();
  const path = `/projects/${args.id}/views/${viewId}/tasks${queryString ? `?${queryString}` : ''}`;

  const items = await vikunjaRestRequest<unknown[]>(authManager, 'GET', path);
  const itemList = Array.isArray(items) ? items : [];

  const response = createStandardResponse(
    'list-view-tasks',
    `Found ${itemList.length} item(s) in view ${viewId} of project ${args.id}`,
    {
      projectId: args.id,
      viewId,
      page: args.page ?? 1,
      ...(args.perPage !== undefined && { perPage: args.perPage }),
      viewItems: itemList,
    },
    {
      timestamp: new Date().toISOString(),
      count: itemList.length,
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}
