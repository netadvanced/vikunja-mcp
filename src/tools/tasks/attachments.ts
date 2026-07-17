/**
 * Attachments read-side subcommands of `vikunja_tasks`.
 *
 * Complements `attach.ts`'s upload path (`PUT /tasks/{id}/attachments`) with:
 *   - `list-attachments`:    `GET /tasks/{id}/attachments` (page/per_page).
 *   - `get-attachment-info`: metadata for one attachment. The spec has no
 *     single-attachment metadata endpoint — `GET
 *     /tasks/{id}/attachments/{attachmentID}` returns the raw file bytes,
 *     not JSON — so this is derived by fetching the list and finding the
 *     matching id, the same fetch-list-and-filter shape `vikunja_webhooks`
 *     uses for its `get` subcommand (no per-id GET exists there either).
 *   - `delete-attachment`:   `DELETE /tasks/{id}/attachments/{attachmentID}`.
 *   - `download-attachment`: per the OpenAPI spec, `GET
 *     /tasks/{id}/attachments/{attachmentID}` produces
 *     `application/octet-stream`. MCP has no binary/file-delivery channel
 *     (see docs/API_NOTES.md's "MCP-Specific Limitations"), so this cannot
 *     fetch and hand back the file itself. Honesty over pretending
 *     (docs/ENDPOINT-PLAYBOOK.md §7): it returns the direct download URL and
 *     the auth header the caller needs to fetch it themselves — the same
 *     shape as `vikunja_download_user_export` in `src/tools/export.ts`.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest, resolveBaseUrl } from '../../utils/vikunja-rest';
import type { components } from '../../types/generated/vikunja-openapi';

type VikunjaTaskAttachment = components['schemas']['models.TaskAttachment'];

/** Preview sizes documented for the download endpoint's `preview_size` query param. */
export type AttachmentPreviewSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AttachmentSubcommandArgs {
  /** Id of the task the attachment belongs to. */
  id?: number;
  /** Id of a specific attachment (required by get-attachment-info, delete-attachment, download-attachment). */
  attachmentId?: number;
  /** Pagination (list-attachments, get-attachment-info). */
  page?: number;
  perPage?: number;
  /** Preview image size hint for download-attachment (spec: sm/md/lg/xl). */
  previewSize?: AttachmentPreviewSize;
  /** Session id for AORP response tracking. */
  sessionId?: string;
}

type McpTextResult = { content: Array<{ type: 'text'; text: string }> };

function requireTaskId(args: AttachmentSubcommandArgs, op: string): number {
  if (args.id === undefined || args.id === null) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, `Task id is required for ${op}`);
  }
  validateId(args.id, 'id');
  return args.id;
}

function requireAttachmentId(args: AttachmentSubcommandArgs, op: string): number {
  if (args.attachmentId === undefined || args.attachmentId === null) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, `attachmentId is required for ${op}`);
  }
  validateId(args.attachmentId, 'attachmentId');
  return args.attachmentId;
}

function buildPaginationQuery(args: AttachmentSubcommandArgs): string {
  if (args.page !== undefined) validateId(args.page, 'page');
  if (args.perPage !== undefined) validateId(args.perPage, 'perPage');
  const params = new URLSearchParams();
  if (args.page !== undefined) params.set('page', String(args.page));
  if (args.perPage !== undefined) params.set('per_page', String(args.perPage));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function fetchAttachments(
  authManager: AuthManager,
  taskId: number,
  args: AttachmentSubcommandArgs,
): Promise<VikunjaTaskAttachment[]> {
  const items = await vikunjaRestRequest<VikunjaTaskAttachment[]>(
    authManager,
    'GET',
    `/tasks/${taskId}/attachments${buildPaginationQuery(args)}`,
  );
  return Array.isArray(items) ? items : [];
}

function summarizeAttachment(attachment: VikunjaTaskAttachment): Record<string, unknown> {
  return {
    id: attachment.id ?? null,
    filename: attachment.file?.name ?? null,
    size: attachment.file?.size ?? null,
    mime: attachment.file?.mime ?? null,
    created: attachment.created ?? null,
    createdBy: attachment.created_by
      ? {
          id: attachment.created_by.id ?? null,
          username: attachment.created_by.username ?? null,
          name: attachment.created_by.name ?? null,
        }
      : null,
  };
}

/**
 * Lists a task's attachments (`GET /tasks/{id}/attachments`).
 */
export async function listAttachments(
  args: AttachmentSubcommandArgs,
  authManager: AuthManager,
): Promise<McpTextResult> {
  const taskId = requireTaskId(args, 'list-attachments operation');
  const attachments = await fetchAttachments(authManager, taskId, args);

  const response = createStandardResponse(
    'list-attachments',
    `Task ${taskId} has ${attachments.length} attachment(s)`,
    {
      taskId,
      attachments: attachments.map(summarizeAttachment),
      count: attachments.length,
    },
    {
      timestamp: new Date().toISOString(),
      count: attachments.length,
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.perPage !== undefined ? { perPage: args.perPage } : {}),
    },
    args.sessionId,
  );

  return { content: [{ type: 'text', text: formatAorpAsMarkdown(response) }] };
}

/**
 * Retrieves metadata (file name, size, mime, created, author) for a single
 * attachment. There is no dedicated single-attachment metadata endpoint in
 * the spec, so this fetches the list and picks out the matching id.
 */
export async function getAttachmentInfo(
  args: AttachmentSubcommandArgs,
  authManager: AuthManager,
): Promise<McpTextResult> {
  const taskId = requireTaskId(args, 'get-attachment-info operation');
  const attachmentId = requireAttachmentId(args, 'get-attachment-info operation');

  const attachments = await fetchAttachments(authManager, taskId, args);
  const attachment = attachments.find((a) => a.id === attachmentId);

  if (!attachment) {
    throw new MCPError(
      ErrorCode.NOT_FOUND,
      `Attachment ${attachmentId} not found on task ${taskId}` +
        (args.page !== undefined || args.perPage !== undefined
          ? ' on the requested page — pass a different page/perPage to search elsewhere'
          : ' on the default page — pass page/perPage to search further pages if the task has many attachments'),
    );
  }

  const response = createStandardResponse(
    'get-attachment-info',
    `Retrieved metadata for attachment ${attachmentId} on task ${taskId}`,
    { taskId, ...summarizeAttachment(attachment) },
    { timestamp: new Date().toISOString() },
    args.sessionId,
  );

  return { content: [{ type: 'text', text: formatAorpAsMarkdown(response) }] };
}

/**
 * Deletes an attachment (`DELETE /tasks/{id}/attachments/{attachmentID}`).
 */
export async function deleteAttachment(
  args: AttachmentSubcommandArgs,
  authManager: AuthManager,
): Promise<McpTextResult> {
  const taskId = requireTaskId(args, 'delete-attachment operation');
  const attachmentId = requireAttachmentId(args, 'delete-attachment operation');

  await vikunjaRestRequest(
    authManager,
    'DELETE',
    `/tasks/${taskId}/attachments/${attachmentId}`,
  );

  const response = createStandardResponse(
    'delete-attachment',
    `Deleted attachment ${attachmentId} from task ${taskId}`,
    { taskId, attachmentId, deleted: true },
    { timestamp: new Date().toISOString(), affectedFields: ['attachments'] },
    args.sessionId,
  );

  return { content: [{ type: 'text', text: formatAorpAsMarkdown(response) }] };
}

/**
 * Returns the direct download URL for an attachment plus auth guidance,
 * instead of pretending this tool can deliver the binary file itself. See
 * the module doc comment for why: `GET
 * /tasks/{id}/attachments/{attachmentID}` returns
 * `application/octet-stream`, and MCP has no binary content channel.
 */
export function downloadAttachment(
  args: AttachmentSubcommandArgs,
  authManager: AuthManager,
): McpTextResult {
  const taskId = requireTaskId(args, 'download-attachment operation');
  const attachmentId = requireAttachmentId(args, 'download-attachment operation');

  const session = authManager.getSession();
  const baseUrl = resolveBaseUrl(session.apiUrl);
  const query = args.previewSize ? `?preview_size=${encodeURIComponent(args.previewSize)}` : '';
  const downloadUrl = `${baseUrl}/tasks/${taskId}/attachments/${attachmentId}${query}`;

  const response = createStandardResponse(
    'download-attachment',
    'This endpoint returns application/octet-stream (the raw file bytes) per the ' +
      'Vikunja API spec, and the MCP protocol has no channel to deliver binary ' +
      'content through this tool. Fetch downloadUrl yourself with an ' +
      '`Authorization: Bearer <token>` header, using the same token this server ' +
      'is configured with, to retrieve the file.',
    {
      taskId,
      attachmentId,
      downloadUrl,
      authHeader: 'Authorization: Bearer <your Vikunja API token>',
      deliveredThroughThisTool: false,
    },
    { timestamp: new Date().toISOString() },
    args.sessionId,
  );

  return { content: [{ type: 'text', text: formatAorpAsMarkdown(response) }] };
}
