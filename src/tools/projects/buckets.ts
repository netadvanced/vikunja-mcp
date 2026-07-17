/**
 * Project Kanban bucket operations
 *
 * Implements `list-buckets`, which returns the buckets (columns) of a
 * project's Kanban view. This lets callers resolve a bucket by name (e.g.
 * "Doing") instead of hard-coding numeric bucket ids.
 *
 * node-vikunja does not expose the Kanban view endpoints, so this calls the
 * Vikunja REST API directly via the shared `vikunja-rest` helper.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest, resolveKanbanView } from '../../utils/vikunja-rest';

export interface ListBucketsArgs {
  /** Project whose Kanban buckets should be listed. */
  id?: number;
  /** Optional Kanban view id. Auto-resolved from the project when omitted. */
  viewId?: number;
  /** Session id for response tracking. */
  sessionId?: string;
}

interface VikunjaBucket {
  id: number;
  title: string;
  project_view_id?: number;
  position?: number;
  limit?: number;
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
      'Project id is required for list-buckets operation',
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
