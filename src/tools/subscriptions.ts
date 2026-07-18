/**
 * Subscriptions Tool
 *
 * Wraps Vikunja's `/subscriptions/{entity}/{entityID}` endpoints (see
 * docs/vikunja-openapi.json):
 *   - PUT    /subscriptions/{entity}/{entityID}  -> subscribe
 *   - DELETE /subscriptions/{entity}/{entityID}  -> unsubscribe
 *
 * Design note (docs/ENDPOINT-PLAYBOOK.md §7 leaves the tool-vs-subcommand
 * choice to the implementer): this is a standalone tool rather than
 * subcommands bolted onto `vikunja_tasks`/`vikunja_projects`. Both
 * endpoints share one shape parameterized only by `entity` ('project' |
 * 'task') and `entityID` — a single small tool covers both entity kinds
 * uniformly, is easy for an AI caller to find by name ("how do I
 * subscribe/unsubscribe from notifications on X"), and avoids growing the
 * already-large tasks/projects tool files with logic that has nothing to do
 * with task or project CRUD.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getAuthManagerFromContext } from '../client';
import { logger } from '../utils/logger';
import { validateAndConvertId } from '../utils/validation';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

/** `models.Subscription` per the spec. */
interface VikunjaSubscription {
  id?: number;
  entity?: number;
  entity_id?: number;
  created?: string;
}

const SubscriptionEntitySchema = z.enum(['project', 'task']);

export function registerSubscriptionsTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_subscriptions',
    withReadOnlyNote(
      'vikunja_subscriptions',
      'Subscribe or unsubscribe the current user to/from notifications for a ' +
        'Vikunja project or task.',
    ),
    {
      subcommand: z.enum(['subscribe', 'unsubscribe']),
      entity: SubscriptionEntitySchema,
      entityId: z.number().int().positive(),
    },
    getToolAnnotations('vikunja_subscriptions'),
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      await getAuthManagerFromContext(); // Ensure the session is initialized
      const subcommand = args.subcommand;
      const entity = args.entity;

      assertWriteAllowed('vikunja_subscriptions', subcommand);

      logger.debug('Subscriptions tool called', { subcommand, entity, entityId: args.entityId });

      try {
        const entityId = validateAndConvertId(args.entityId, 'entityId');

        switch (subcommand) {
          case 'subscribe': {
            const subscription = await vikunjaRestRequest<VikunjaSubscription>(
              authManager,
              'PUT',
              `/subscriptions/${entity}/${entityId}`,
            );

            logger.info('Subscribed', { entity, entityId });

            const aorpResult = createAorpResponse(
              'subscribe',
              `Subscribed to ${entity} ${entityId}`,
              { subscription },
              { success: true, metadata: { count: 1 } },
            );

            return {
              content: [{ type: 'text' as const, text: aorpResult.content }],
            };
          }

          case 'unsubscribe': {
            try {
              const subscription = await vikunjaRestRequest<VikunjaSubscription>(
                authManager,
                'DELETE',
                `/subscriptions/${entity}/${entityId}`,
              );

              logger.info('Unsubscribed', { entity, entityId });

              const aorpResult = createAorpResponse(
                'unsubscribe',
                `Unsubscribed from ${entity} ${entityId}`,
                { subscription },
                { success: true, metadata: { count: 1 } },
              );

              return {
                content: [{ type: 'text' as const, text: aorpResult.content }],
              };
            } catch (error) {
              // Ensure-semantics (docs/ENDPOINT-PLAYBOOK.md §1): the caller's
              // intent is "make sure I'm not subscribed" — a 404 ("The
              // subscription does not exist", per the spec) already
              // satisfies that intent, so treat it as a successful no-op
              // rather than an error, matching the idempotent-delete
              // pattern used elsewhere in this codebase.
              if (error instanceof MCPError && error.details?.statusCode === 404) {
                logger.info('Unsubscribe no-op: not subscribed', { entity, entityId });

                const aorpResult = createAorpResponse(
                  'unsubscribe',
                  `Already not subscribed to ${entity} ${entityId}`,
                  {},
                  { success: true, metadata: { count: 0 } },
                );

                return {
                  content: [{ type: 'text' as const, text: aorpResult.content }],
                };
              }
              throw error;
            }
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${subcommand as string}`,
            );
        }
      } catch (error) {
        logger.error('Subscriptions operation failed', {
          error,
          subcommand,
          entity,
          entityId: args.entityId,
        });

        if (error instanceof MCPError) {
          const statusCode = error.details?.statusCode;
          if (statusCode === 412) {
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid subscription entity "${entity}". Must be "project" or "task".`,
            );
          }
          if (statusCode === 403) {
            throw new MCPError(
              ErrorCode.PERMISSION_DENIED,
              `You do not have access to subscribe to ${entity} ${args.entityId}.`,
            );
          }
          throw error;
        }

        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `Subscriptions operation failed: ${error.message}`);
        }

        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during a subscriptions operation',
        );
      }
    },
  );
}
