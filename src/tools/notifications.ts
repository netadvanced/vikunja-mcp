/**
 * Notifications Tool
 *
 * Wraps Vikunja's `/notifications` endpoints (see docs/vikunja-openapi.json):
 *   - GET  /notifications        -> list, with page/per_page pagination
 *   - POST /notifications        -> mark every notification read
 *   - POST /notifications/{id}   -> toggle a single notification's read state
 *
 * All calls go through `vikunjaRestRequest` (direct-REST rule, see
 * docs/ENDPOINT-PLAYBOOK.md §3) — legacy client has no notifications support
 * to migrate away from, so this is a pure new call site.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getAuthManagerFromContext } from '../client';
import { logger } from '../utils/logger';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';
import { validateAndConvertId } from '../utils/validation';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';

/**
 * Shape of a notification as returned by `GET /notifications`
 * (`notifications.DatabaseNotification` in the spec) and by
 * `POST /notifications/{id}` (`models.DatabaseNotifications`, which adds a
 * `read` boolean alongside the same fields). The spec leaves `notification`
 * completely untyped (`"description": "The actual content of the
 * notification."`, no `type`/`$ref`) — its shape varies by notification kind
 * and is not documented, so it is passed through as `unknown` rather than
 * guessed at (see docs/ENDPOINT-PLAYBOOK.md §2: never infer field shapes
 * that aren't in the spec).
 */
interface VikunjaNotification {
  id: number;
  name: string;
  created: string;
  notification?: unknown;
  read_at?: string | null;
  read?: boolean;
}

/**
 * Best-effort, zero-extra-request enrichment: some notification kinds (e.g.
 * task assignment, task comments) embed a `{ task: { id, title } }` shape in
 * their untyped `notification` payload in practice, but this is NOT
 * documented in the OpenAPI spec (see `VikunjaNotification` doc comment
 * above) — so this is purely a defensive, best-effort extraction over data
 * already in hand from the `list` response, never a new API call, and it
 * silently returns `undefined` (rather than throwing) whenever the shape
 * doesn't match. This is what backs the `list` subcommand's optional
 * `relatedTask` convenience field.
 */
function extractRelatedTask(content: unknown): { id: number; title: string } | undefined {
  if (!content || typeof content !== 'object') {
    return undefined;
  }
  const task = (content as Record<string, unknown>).task;
  if (!task || typeof task !== 'object') {
    return undefined;
  }
  const id = (task as Record<string, unknown>).id;
  const title = (task as Record<string, unknown>).title;
  if (typeof id === 'number' && typeof title === 'string') {
    return { id, title };
  }
  return undefined;
}

/**
 * Ensures a notification ends up marked READ, working around
 * `POST /notifications/{id}` being a pure toggle in the API (per the spec:
 * "Marks a notification as either read or unread", no request body to pick
 * which). A blind single POST would silently mark an already-read
 * notification unread again on a repeat call — this makes `mark-read`
 * idempotent (verify-then-apply, docs/ENDPOINT-PLAYBOOK.md §1) by checking
 * the response and, if the toggle landed on "unread", toggling once more.
 * At most 2 requests; typically 1.
 */
async function ensureNotificationRead(
  authManager: AuthManager,
  notificationId: number,
): Promise<VikunjaNotification> {
  let notification = await vikunjaRestRequest<VikunjaNotification>(
    authManager,
    'POST',
    `/notifications/${notificationId}`,
  );
  if (!notification?.read_at) {
    notification = await vikunjaRestRequest<VikunjaNotification>(
      authManager,
      'POST',
      `/notifications/${notificationId}`,
    );
  }
  return notification;
}

export function registerNotificationsTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_notifications',
    withReadOnlyNote(
      'vikunja_notifications',
      "Manage the current user's Vikunja notifications: list (with optional " +
        "unread filtering and pagination), mark a single notification read " +
        "(idempotent — safe to call repeatedly), and mark all notifications " +
        "read at once.",
    ),
    {
      subcommand: z.enum(['list', 'mark-read', 'mark-all-read']),

      // list parameters
      unreadOnly: z.boolean().optional(),
      page: z.number().int().positive().optional(),
      perPage: z.number().int().positive().optional(),

      // mark-read parameter
      notificationId: z.number().int().positive().optional(),
    },
    getToolAnnotations('vikunja_notifications'),
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      await getAuthManagerFromContext(); // Ensure the session is initialized
      const subcommand = args.subcommand;

      assertWriteAllowed('vikunja_notifications', subcommand);

      logger.debug('Notifications tool called', { subcommand, args });

      try {
        switch (subcommand) {
          case 'list': {
            const query: string[] = [];
            if (args.page !== undefined) {
              query.push(`page=${encodeURIComponent(String(args.page))}`);
            }
            if (args.perPage !== undefined) {
              query.push(`per_page=${encodeURIComponent(String(args.perPage))}`);
            }
            const qs = query.length > 0 ? `?${query.join('&')}` : '';

            const allNotifications =
              (await vikunjaRestRequest<VikunjaNotification[]>(
                authManager,
                'GET',
                `/notifications${qs}`,
              )) ?? [];

            // The spec's page/per_page are the only server-side filters
            // documented for this endpoint — there is no server-side
            // unread filter, so `unreadOnly` is applied client-side over the
            // fetched page.
            const notifications = args.unreadOnly
              ? allNotifications.filter((n) => !n.read_at)
              : allNotifications;

            // Read-composite (docs/ENDPOINT-PLAYBOOK.md §1): attach a
            // best-effort relatedTask summary with zero extra requests,
            // see extractRelatedTask() doc comment for why this is
            // heuristic rather than spec-guaranteed.
            const enriched = notifications.map((n) => {
              const relatedTask = extractRelatedTask(n.notification);
              return relatedTask ? { ...n, relatedTask } : n;
            });

            logger.info('Listed notifications', {
              count: enriched.length,
              unreadOnly: !!args.unreadOnly,
            });

            const aorpResult = createAorpResponse(
              'list',
              `Retrieved ${enriched.length} notification(s)`,
              { notifications: enriched },
              {
                success: true,
                metadata: {
                  count: enriched.length,
                },
              },
            );

            return {
              content: [{ type: 'text' as const, text: aorpResult.content }],
            };
          }

          case 'mark-read': {
            const notificationId = validateAndConvertId(args.notificationId, 'notificationId');

            const notification = await ensureNotificationRead(authManager, notificationId);

            logger.info('Marked notification read', { notificationId });

            const aorpResult = createAorpResponse(
              'mark-read',
              `Notification ${notificationId} marked as read`,
              { notification },
              {
                success: true,
                metadata: { count: 1 },
              },
            );

            return {
              content: [{ type: 'text' as const, text: aorpResult.content }],
            };
          }

          case 'mark-all-read': {
            const result = await vikunjaRestRequest<{ message?: string }>(
              authManager,
              'POST',
              '/notifications',
            );

            logger.info('Marked all notifications read');

            const aorpResult = createAorpResponse(
              'mark-all-read',
              result?.message ?? 'All notifications marked as read',
              {},
              { success: true },
            );

            return {
              content: [{ type: 'text' as const, text: aorpResult.content }],
            };
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${subcommand as string}`,
            );
        }
      } catch (error) {
        logger.error('Notifications operation failed', { error, subcommand, args });

        if (error instanceof MCPError) {
          // Link shares cannot have notifications — the spec documents a
          // dedicated 403 for this case; surface it plainly rather than the
          // generic HTTP error text.
          const statusCode = error.details?.statusCode;
          if (statusCode === 403) {
            throw new MCPError(
              ErrorCode.PERMISSION_DENIED,
              'Link shares cannot have notifications. Authenticate as a full user to use vikunja_notifications.',
            );
          }
          throw error;
        }

        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `Notifications operation failed: ${error.message}`);
        }

        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during a notifications operation',
        );
      }
    },
  );
}
