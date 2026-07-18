/**
 * Webhooks Tool
 * Handles webhook operations for Vikunja projects
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

// Event cache for validation
let cachedEvents: string[] | null = null;
let cacheExpiry: Date | null = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Default webhook events used when the API's events endpoint is unavailable.
// See docs/VIKUNJA_API_ISSUES.md #8: `/webhooks/events` is known to return
// 401 even with a valid token on some server configurations.
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

// Export for testing purposes
export function clearWebhookEventCache(): void {
  cachedEvents = null;
  cacheExpiry = null;
}

// Export for testing - expire cache but keep events
export function expireWebhookEventCache(): void {
  cacheExpiry = new Date(0); // Set to past date
}

// Use shared validateAndConvertId from utils/validation

// Get valid webhook events with caching
async function getValidEvents(authManager: AuthManager): Promise<string[]> {
  const now = new Date();

  // Return cached events if still valid
  if (cachedEvents && cacheExpiry && cacheExpiry > now) {
    logger.debug('Using cached webhook events', {
      eventsCount: cachedEvents.length,
      expiresIn: Math.round((cacheExpiry.getTime() - now.getTime()) / 1000) + 's',
    });
    return cachedEvents;
  }

  // Fetch fresh events
  logger.debug('Fetching fresh webhook events from API');
  try {
    // Retry disabled: this call already has its own fallback-on-any-error
    // semantics below (stale cache, then DEFAULT_WEBHOOK_EVENTS), including
    // for the known /webhooks/events 401-with-valid-token quirk (see
    // docs/VIKUNJA_API_ISSUES.md #8). Retrying first would only add latency
    // before falling back to the same place.
    const events = await vikunjaRestRequest<string[]>(authManager, 'GET', '/webhooks/events', undefined, {
      retry: { maxRetries: 0 },
    });
    cachedEvents = events ?? [];
    cacheExpiry = new Date(now.getTime() + CACHE_DURATION_MS);
    logger.info('Webhook events cached', {
      eventsCount: cachedEvents.length,
      expiresAt: cacheExpiry.toISOString(),
    });
    return cachedEvents;
  } catch (error) {
    const statusCode = error instanceof MCPError ? error.details?.statusCode : undefined;
    // If webhook events endpoint doesn't exist or returns auth error, use default events
    if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
      logger.warn('Webhook events endpoint not available, using default event list');
      cachedEvents = [...DEFAULT_WEBHOOK_EVENTS];
      cacheExpiry = new Date(now.getTime() + CACHE_DURATION_MS);
      return cachedEvents;
    }

    logger.error('Failed to fetch webhook events', { error });
    // If we have stale cache, use it rather than failing
    if (cachedEvents) {
      logger.warn('Using stale cached webhook events due to API error');
      return cachedEvents;
    }
    // If no cache and fetch failed, use default events
    logger.warn('Using default webhook events due to API error');
    cachedEvents = [...DEFAULT_WEBHOOK_EVENTS];
    cacheExpiry = new Date(now.getTime() + CACHE_DURATION_MS);
    return cachedEvents;
  }
}

// Validate webhook events against allowed list
async function validateWebhookEvents(authManager: AuthManager, events: string[]): Promise<void> {
  const validEvents = await getValidEvents(authManager);
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
      'Manage webhooks for integrating Vikunja events with external services',
    ),
    {
      // Operation type
      subcommand: z.enum(['list', 'get', 'create', 'update', 'delete', 'list-events']),

      // Common parameters
      projectId: z.number().int().positive().optional(),
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

      assertWriteAllowed('vikunja_webhooks', subcommand);

      logger.debug('Webhooks tool called', { subcommand, args });

      try {
        switch (subcommand) {
          case 'list': {
            const projectId = validateAndConvertId(args.projectId, 'projectId');

            const webhooks =
              (await vikunjaRestRequest<Webhook[]>(
                authManager,
                'GET',
                `/projects/${projectId}/webhooks`,
              )) ?? [];

            logger.info('Listed webhooks', { projectId, count: webhooks.length });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'list',
              `Retrieved ${webhooks.length} webhooks for project ${projectId}`,
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
            const projectId = validateAndConvertId(args.projectId, 'projectId');
            const webhookId = validateAndConvertId(args.webhookId, 'webhookId');

            // Get all webhooks and find the specific one
            const webhooks =
              (await vikunjaRestRequest<Webhook[]>(
                authManager,
                'GET',
                `/projects/${projectId}/webhooks`,
              )) ?? [];

            const webhook = webhooks.find((w: Webhook) => w.id === webhookId);

            if (!webhook) {
              throw new MCPError(
                ErrorCode.NOT_FOUND,
                `Webhook with ID ${webhookId} not found in project ${projectId}`,
              );
            }

            logger.info('Retrieved webhook', { projectId, webhookId });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'get',
              `Retrieved webhook ${webhookId} for project ${projectId}`,
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
            const projectId = validateAndConvertId(args.projectId, 'projectId');

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
            await validateWebhookEvents(authManager, args.events);

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
              `/projects/${projectId}/webhooks`,
              webhookData,
            );

            logger.info('Created webhook', { projectId, webhookId: webhook.id });

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
            const projectId = validateAndConvertId(args.projectId, 'projectId');
            const webhookId = validateAndConvertId(args.webhookId, 'webhookId');

            if (!args.events || args.events.length === 0) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'At least one event is required for updating a webhook',
              );
            }

            // Validate events against allowed list
            await validateWebhookEvents(authManager, args.events);

            // The API only allows updating events
            const updateData = {
              events: args.events,
            };

            const webhook = await vikunjaRestRequest<Webhook>(
              authManager,
              'POST',
              `/projects/${projectId}/webhooks/${webhookId}`,
              updateData,
            );

            logger.info('Updated webhook events', { projectId, webhookId, events: args.events });

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
            const projectId = validateAndConvertId(args.projectId, 'projectId');
            const webhookId = validateAndConvertId(args.webhookId, 'webhookId');

            await vikunjaRestRequest(
              authManager,
              'DELETE',
              `/projects/${projectId}/webhooks/${webhookId}`,
            );

            logger.info('Deleted webhook', { projectId, webhookId });

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
            const events = await getValidEvents(authManager);

            logger.info('Listed available webhook events', { count: events.length });

            // Use AORP factory for consistent response format
            const aorpResult = createAorpResponse(
              'list-events',
              `Retrieved ${events.length} available webhook events`,
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
        logger.error('Webhook operation failed', { error, subcommand, args });

        if (error instanceof MCPError) {
          // vikunjaRestRequest surfaces 401/403 as a generic HTTP error; give
          // callers the documented, more actionable message instead (see
          // docs/VIKUNJA_API_ISSUES.md #8 - webhook endpoints are known to
          // reject otherwise-valid tokens on some server configurations).
          const statusCode = error.details?.statusCode;
          if (statusCode === 401 || statusCode === 403) {
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
