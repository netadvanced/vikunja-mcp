/**
 * Webhooks Tool
 * Handles webhook operations for Vikunja projects (`scope: 'project'`, the
 * default) and for the current user's account-wide webhooks
 * (`scope: 'user'`, G4 - see docs/ENDPOINT-TAIL-RETRIAGE.md).
 *
 * User-level webhooks (`/user/settings/webhooks*`) use the **identical**
 * `models.Webhook` shape as project webhooks - same subcommands
 * (list/get/create/update/delete/list-events), same request/response
 * fields. This module reuses one set of handlers, switching only the REST
 * path and a couple of scope-specific messages, rather than duplicating the
 * project-webhook logic for a second surface.
 *
 * Per the vendored OpenAPI spec, every `/user/settings/webhooks*` operation
 * is declared `JWTKeyAuth`-only (as, in fact, are the project-webhook
 * routes too - the spec's security scheme is not consistently reliable
 * here, see docs/VIKUNJA_API_ISSUES.md #8). Rather than gate `scope: 'user'`
 * at tool-registration time the way the always-JWT-only `vikunja_users`
 * tool is gated (this is one tool mixing both scopes behind a single
 * per-call argument, not a separate tool), this module follows the
 * `vikunja_tokens` precedent (src/tools/tokens.ts): register unconditionally
 * and surface a clear, scope-aware message if the server rejects the call
 * for the connected token's auth type.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getAuthManagerFromContext } from '../client';
import type { Webhook } from '../types/vikunja';
import { logger } from '../utils/logger';
import { validateAndConvertId } from '../utils/validation';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

type WebhookScope = 'project' | 'user';

// Event cache for validation - one entry per scope, since project and
// user-level webhooks are validated against separate `.../webhooks/events`
// endpoints that may (in principle) return different valid-event sets.
interface EventCacheEntry {
  events: string[] | null;
  expiry: Date | null;
}

const eventCache: Record<WebhookScope, EventCacheEntry> = {
  project: { events: null, expiry: null },
  user: { events: null, expiry: null },
};

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Default webhook events used when the API's events endpoint is unavailable.
// See docs/VIKUNJA_API_ISSUES.md #8: `/webhooks/events` is known to return
// 401 even with a valid token on some server configurations. The same
// fallback list is used for both scopes - a reasonable default event set
// either way.
const DEFAULT_WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.assigned',
  'task.comment.created',
  'project.created',
  'project.updated',
  'project.deleted',
  'project.shared',
  'team.created',
  'team.deleted',
];

// Export for testing purposes - clears both scopes' caches.
export function clearWebhookEventCache(): void {
  eventCache.project = { events: null, expiry: null };
  eventCache.user = { events: null, expiry: null };
}

// Export for testing - expire both scopes' caches but keep their events.
export function expireWebhookEventCache(): void {
  const past = new Date(0);
  eventCache.project.expiry = past;
  eventCache.user.expiry = past;
}

// ---------------------------------------------------------------------------
// Scope-aware REST paths
// ---------------------------------------------------------------------------

function webhookCollectionPath(scope: WebhookScope, projectId?: number): string {
  return scope === 'project' ? `/projects/${projectId}/webhooks` : '/user/settings/webhooks';
}

function webhookItemPath(scope: WebhookScope, webhookId: number, projectId?: number): string {
  return scope === 'project'
    ? `/projects/${projectId}/webhooks/${webhookId}`
    : `/user/settings/webhooks/${webhookId}`;
}

function webhookEventsPath(scope: WebhookScope): string {
  return scope === 'project' ? '/webhooks/events' : '/user/settings/webhooks/events';
}

// ---------------------------------------------------------------------------
// scope / projectId consistency (discriminated union, per-scope requirement)
// ---------------------------------------------------------------------------

// projectId is required for scope 'project' (there is no way to address
// /projects/{id}/webhooks* without it) and forbidden for scope 'user'
// (/user/settings/webhooks* is never project-scoped - the spec's
// models.Webhook documents project_id/user_id as mutually exclusive).
// Presence only is checked here; actual type/range validation of a
// supplied projectId still goes through validateAndConvertId below so its
// existing, more specific error messages are unaffected.
const RequiredForProjectScope = z.unknown().refine((value) => value !== undefined, {
  message: "projectId is required when scope is 'project'",
});

const WebhookScopeConsistencySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('project'), projectId: RequiredForProjectScope }),
  z.object({ scope: z.literal('user') }).strict(),
]);

function assertScopeConsistency(scope: WebhookScope, projectId: number | undefined): void {
  const input: Record<string, unknown> = { scope };
  if (projectId !== undefined) {
    input.projectId = projectId;
  }

  const result = WebhookScopeConsistencySchema.safeParse(input);
  if (!result.success) {
    const message =
      scope === 'project'
        ? "projectId is required when scope is 'project'"
        : "projectId must not be provided when scope is 'user' (user-level webhooks are account-wide, not project-scoped)";
    throw new MCPError(ErrorCode.VALIDATION_ERROR, message);
  }
}

// Use shared validateAndConvertId from utils/validation

// Get valid webhook events with caching
async function getValidEvents(authManager: AuthManager, scope: WebhookScope): Promise<string[]> {
  const now = new Date();
  const cache = eventCache[scope];

  // Return cached events if still valid
  if (cache.events && cache.expiry && cache.expiry > now) {
    logger.debug('Using cached webhook events', {
      scope,
      eventsCount: cache.events.length,
      expiresIn: Math.round((cache.expiry.getTime() - now.getTime()) / 1000) + 's',
    });
    return cache.events;
  }

  // Fetch fresh events
  logger.debug('Fetching fresh webhook events from API', { scope });
  try {
    // Retry disabled: this call already has its own fallback-on-any-error
    // semantics below (stale cache, then DEFAULT_WEBHOOK_EVENTS), including
    // for the known /webhooks/events 401-with-valid-token quirk (see
    // docs/VIKUNJA_API_ISSUES.md #8). Retrying first would only add latency
    // before falling back to the same place.
    const events = await vikunjaRestRequest<string[]>(
      authManager,
      'GET',
      webhookEventsPath(scope),
      undefined,
      { retry: { maxRetries: 0 } },
    );
    cache.events = events ?? [];
    cache.expiry = new Date(now.getTime() + CACHE_DURATION_MS);
    logger.info('Webhook events cached', {
      scope,
      eventsCount: cache.events.length,
      expiresAt: cache.expiry.toISOString(),
    });
    return cache.events;
  } catch (error) {
    const statusCode = error instanceof MCPError ? error.details?.statusCode : undefined;
    // If webhook events endpoint doesn't exist or returns auth error, use default events
    if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
      logger.warn('Webhook events endpoint not available, using default event list', { scope });
      cache.events = [...DEFAULT_WEBHOOK_EVENTS];
      cache.expiry = new Date(now.getTime() + CACHE_DURATION_MS);
      return cache.events;
    }

    logger.error('Failed to fetch webhook events', { error, scope });
    // If we have stale cache, use it rather than failing
    if (cache.events) {
      logger.warn('Using stale cached webhook events due to API error', { scope });
      return cache.events;
    }
    // If no cache and fetch failed, use default events
    logger.warn('Using default webhook events due to API error', { scope });
    cache.events = [...DEFAULT_WEBHOOK_EVENTS];
    cache.expiry = new Date(now.getTime() + CACHE_DURATION_MS);
    return cache.events;
  }
}

// Validate webhook events against allowed list
async function validateWebhookEvents(
  authManager: AuthManager,
  scope: WebhookScope,
  events: string[],
): Promise<void> {
  const validEvents = await getValidEvents(authManager, scope);
  const invalidEvents = events.filter((event) => !validEvents.includes(event));

  if (invalidEvents.length > 0) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid webhook events: ${invalidEvents.join(', ')}. Valid events are: ${validEvents.join(', ')}`,
    );
  }
}

export function registerWebhooksTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_webhooks',
    withReadOnlyNote(
      'vikunja_webhooks',
      "Manage webhooks for integrating Vikunja events with external services. 'scope' selects which webhook family to operate on: 'project' (default) manages a single project's webhooks (PUT/GET/POST/DELETE /projects/{id}/webhooks*, requires projectId); 'user' manages the current user's account-wide webhooks, which fire across all projects (PUT/GET/POST/DELETE /user/settings/webhooks*, must NOT be combined with projectId). Both scopes share the identical models.Webhook shape and the same subcommands. Per the OpenAPI spec, /user/settings/webhooks* is JWT-only - calls made with an API token (tk_*) session may be rejected by the server.",
    ),
    {
      // Operation type
      subcommand: z.enum(['list', 'get', 'create', 'update', 'delete', 'list-events']),

      // Scope selector - see the tool description above.
      scope: z
        .enum(['project', 'user'])
        .default('project')
        .describe(
          "'project' (default, requires projectId) or 'user' (account-wide webhooks, must omit projectId; JWT-only per the spec).",
        ),

      // Common parameters
      projectId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Required when scope is 'project'; must be omitted when scope is 'user'."),
      webhookId: z.number().int().positive().optional(),

      // Create/Update parameters
      targetUrl: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      secret: z.string().optional(),
    },
    getToolAnnotations('vikunja_webhooks'),
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      await getAuthManagerFromContext(); // Ensure the session is initialized
      const subcommand = args.subcommand;
      const scope: WebhookScope = args.scope ?? 'project';

      assertWriteAllowed('vikunja_webhooks', subcommand);

      // Only the subcommands that actually address a webhook collection/item
      // take a projectId in scope 'project'. list-events hits a
      // scope-global events endpoint (no projectId either way), and an
      // unrecognized subcommand should still fall through to the "Unknown
      // subcommand" error below rather than a scope-consistency error.
      const SUBCOMMANDS_WITH_PROJECT_SCOPE = new Set(['list', 'get', 'create', 'update', 'delete']);
      if (SUBCOMMANDS_WITH_PROJECT_SCOPE.has(subcommand)) {
        assertScopeConsistency(scope, args.projectId);
      }

      logger.debug('Webhooks tool called', { subcommand, scope, args });

      try {
        switch (subcommand) {
          case 'list': {
            const projectId = scope === 'project' ? validateAndConvertId(args.projectId, 'projectId') : undefined;

            const webhooks =
              (await vikunjaRestRequest<Webhook[]>(
                authManager,
                'GET',
                webhookCollectionPath(scope, projectId),
              )) ?? [];

            const description =
              scope === 'project'
                ? `Retrieved ${webhooks.length} webhooks for project ${projectId}`
                : `Retrieved ${webhooks.length} webhooks for the current user`;

            logger.info('Listed webhooks', { scope, projectId, count: webhooks.length });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'list',
              description,
              { webhooks }, // Preserve webhooks data in details.data.webhooks
              {
                success: true,
                metadata: {
                  count: webhooks.length
                }
              }
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: aorpResult.content,
                },
              ],
            };
          }

          case 'get': {
            const projectId = scope === 'project' ? validateAndConvertId(args.projectId, 'projectId') : undefined;
            const webhookId = validateAndConvertId(args.webhookId, 'webhookId');

            // Get all webhooks and find the specific one - the spec has no
            // single-webhook GET in either scope.
            const webhooks =
              (await vikunjaRestRequest<Webhook[]>(
                authManager,
                'GET',
                webhookCollectionPath(scope, projectId),
              )) ?? [];

            const webhook = webhooks.find((w: Webhook) => w.id === webhookId);

            if (!webhook) {
              throw new MCPError(
                ErrorCode.NOT_FOUND,
                scope === 'project'
                  ? `Webhook with ID ${webhookId} not found in project ${projectId}`
                  : `Webhook with ID ${webhookId} not found for the current user`,
              );
            }

            logger.info('Retrieved webhook', { scope, projectId, webhookId });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'get',
              scope === 'project'
                ? `Retrieved webhook ${webhookId} for project ${projectId}`
                : `Retrieved webhook ${webhookId} for the current user`,
              { webhook }, // Preserve webhook data in details.data.webhook
              {
                success: true,
                metadata: {
                  count: 1
                }
              }
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: aorpResult.content,
                },
              ],
            };
          }

          case 'create': {
            const projectId = scope === 'project' ? validateAndConvertId(args.projectId, 'projectId') : undefined;

            if (!args.targetUrl) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'targetUrl is required for creating a webhook',
              );
            }

            if (!args.events || args.events.length === 0) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'At least one event is required for creating a webhook',
              );
            }

            // Validate events against allowed list
            await validateWebhookEvents(authManager, scope, args.events);

            const webhookData: Partial<Webhook> = {
              target_url: args.targetUrl,
              events: args.events,
            };

            if (args.secret !== undefined) {
              webhookData.secret = args.secret;
            }

            const webhook = await vikunjaRestRequest<Webhook>(
              authManager,
              'PUT',
              webhookCollectionPath(scope, projectId),
              webhookData,
            );

            logger.info('Created webhook', { scope, projectId, webhookId: webhook.id });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'create',
              `Webhook created successfully with ID ${webhook.id}`,
              { webhook }, // Preserve webhook data in details.data.webhook
              {
                success: true,
                metadata: {
                  count: 1
                }
              }
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: aorpResult.content,
                },
              ],
            };
          }

          case 'update': {
            const projectId = scope === 'project' ? validateAndConvertId(args.projectId, 'projectId') : undefined;
            const webhookId = validateAndConvertId(args.webhookId, 'webhookId');

            if (!args.events || args.events.length === 0) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'At least one event is required for updating a webhook',
              );
            }

            // Validate events against allowed list
            await validateWebhookEvents(authManager, scope, args.events);

            // The API only allows updating events, in both scopes
            const updateData = {
              events: args.events,
            };

            const webhook = await vikunjaRestRequest<Webhook>(
              authManager,
              'POST',
              webhookItemPath(scope, webhookId, projectId),
              updateData,
            );

            logger.info('Updated webhook events', { scope, projectId, webhookId, events: args.events });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'update',
              'Webhook events updated successfully',
              { webhook }, // Preserve webhook data in details.data.webhook
              {
                success: true,
                metadata: {
                  count: 1,
                  affectedFields: ['events']
                }
              }
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: aorpResult.content,
                },
              ],
            };
          }

          case 'delete': {
            const projectId = scope === 'project' ? validateAndConvertId(args.projectId, 'projectId') : undefined;
            const webhookId = validateAndConvertId(args.webhookId, 'webhookId');

            await vikunjaRestRequest(
              authManager,
              'DELETE',
              webhookItemPath(scope, webhookId, projectId),
            );

            logger.info('Deleted webhook', { scope, projectId, webhookId });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'delete',
              `Webhook ${webhookId} deleted successfully`,
              { webhookId }, // Preserve webhookId in details.data.webhookId
              {
                success: true,
                metadata: {
                  count: 1
                }
              }
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: aorpResult.content,
                },
              ],
            };
          }

          case 'list-events': {
            const events = await getValidEvents(authManager, scope);

            logger.info('Listed available webhook events', { scope, count: events.length });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'list-events',
              scope === 'project'
                ? `Retrieved ${events.length} available webhook events`
                : `Retrieved ${events.length} available user-level webhook events`,
              { events }, // Preserve events data in details.data.events
              {
                success: true,
                metadata: {
                  count: events.length
                }
              }
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: aorpResult.content,
                },
              ],
            };
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${subcommand as string}`,
            );
        }
      } catch (error) {
        logger.error('Webhook operation failed', { error, subcommand, scope, args });

        if (error instanceof MCPError) {
          // vikunjaRestRequest surfaces 401/403 as a generic HTTP error; give
          // callers the documented, more actionable message instead (see
          // docs/VIKUNJA_API_ISSUES.md #8 - webhook endpoints are known to
          // reject otherwise-valid tokens on some server configurations).
          const statusCode = error.details?.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            if (scope === 'user') {
              throw new MCPError(
                ErrorCode.API_ERROR,
                "User-level webhook operations require JWT authentication (per the OpenAPI spec, /user/settings/webhooks* endpoints are JWTKeyAuth-only). Reconnect via vikunja_auth.connect with a JWT token, or use scope: 'project' if you only have an API token.",
              );
            }
            throw new MCPError(
              ErrorCode.API_ERROR,
              'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
            );
          }
          throw error;
        }

        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `Webhook operation failed: ${error.message}`);
        }

        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during webhook operation',
        );
      }
    },
  );
}
