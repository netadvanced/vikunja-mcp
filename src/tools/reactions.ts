/**
 * Reactions Tool
 *
 * Wraps Vikunja's `/{kind}/{id}/reactions` endpoints (see
 * docs/vikunja-openapi.json):
 *   - GET  /{kind}/{id}/reactions         -> list
 *   - PUT  /{kind}/{id}/reactions         -> add
 *   - POST /{kind}/{id}/reactions/delete  -> remove
 *
 * `kind` is a path segment restricted to `tasks` or `comments` (the spec's
 * `"type": "integer"` for this parameter is a swaggo generation artifact —
 * the description and every real usage make clear it's the literal string
 * `tasks`/`comments`, matching `src/types/generated/vikunja-openapi.d.ts`'s
 * own `kind: number` placeholder for the same reason; the Zod enum below is
 * what actually constrains it at the tool boundary).
 *
 * Design note (mirrors src/tools/subscriptions.ts): one small tool covers
 * both entity kinds (tasks and comments) uniformly rather than duplicating
 * add/remove/list logic inside `vikunja_tasks` and `vikunja_task_comments`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getAuthManagerFromContext, hasRequestContext } from '../client';
import { logger } from '../utils/logger';
import { validateAndConvertId } from '../utils/validation';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

/** `models.Reaction` per the spec: the request/response body for add/remove. */
interface VikunjaReaction {
  value?: string;
  created?: string;
  user?: unknown;
}

/**
 * `models.ReactionMap` per the spec is `{ [reactionValue: string]:
 * user.User[] }`. The `list` response schema is documented as an ARRAY of
 * `models.ReactionMap` (`models.ReactionMap[]`, confirmed in both
 * docs/vikunja-openapi.json and the generated types) rather than a single
 * map — kept exactly as specified and passed through unreshaped rather than
 * guessed into a different (possibly wrong) shape.
 */
type VikunjaReactionMap = Record<string, unknown[]>;

const ReactionKindSchema = z.enum(['tasks', 'comments']);

export function registerReactionsTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_reactions',
    withReadOnlyNote(
      'vikunja_reactions',
      'Add, remove, or list emoji/text reactions on a Vikunja task or task comment.',
    ),
    {
      subcommand: z.enum(['list', 'add', 'remove']),
      kind: ReactionKindSchema,
      entityId: z.number().int().positive(),
      // Required for add/remove: the reaction itself (any UTF character or
      // short text, up to 20 characters per the spec).
      value: z.string().min(1).max(20).optional(),
    },
    getToolAnnotations('vikunja_reactions'),
    async (args) => {
      // Closure-gate precedence fix: defer to the per-request context when
      // bound (see hasRequestContext's doc comment, src/client.ts).
      if (hasRequestContext()) {
        await getAuthManagerFromContext();
      } else if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      await getAuthManagerFromContext(); // Ensure the session is initialized
      const subcommand = args.subcommand;
      const kind = args.kind;

      assertWriteAllowed('vikunja_reactions', subcommand);

      logger.debug('Reactions tool called', { subcommand, kind, entityId: args.entityId });

      try {
        const entityId = validateAndConvertId(args.entityId, 'entityId');

        switch (subcommand) {
          case 'list': {
            const reactions =
              (await vikunjaRestRequest<VikunjaReactionMap[]>(
                authManager,
                'GET',
                `/${kind}/${entityId}/reactions`,
              )) ?? [];

            logger.info('Listed reactions', { kind, entityId, count: reactions.length });

            const aorpResult = createAorpResponse(
              'list',
              `Retrieved reactions for ${kind} ${entityId}`,
              { reactions },
              { success: true, metadata: { count: reactions.length } },
            );

            return {
              content: [{ type: 'text' as const, text: aorpResult.content }],
            };
          }

          case 'add': {
            if (!args.value) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'value is required for adding a reaction',
              );
            }

            const reaction = await vikunjaRestRequest<VikunjaReaction>(
              authManager,
              'PUT',
              `/${kind}/${entityId}/reactions`,
              { value: args.value },
            );

            logger.info('Added reaction', { kind, entityId, value: args.value });

            const aorpResult = createAorpResponse(
              'add',
              `Reaction "${args.value}" added to ${kind} ${entityId}`,
              { reaction },
              { success: true, metadata: { count: 1 } },
            );

            return {
              content: [{ type: 'text' as const, text: aorpResult.content }],
            };
          }

          case 'remove': {
            if (!args.value) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'value is required for removing a reaction',
              );
            }

            const result = await vikunjaRestRequest<{ message?: string }>(
              authManager,
              'POST',
              `/${kind}/${entityId}/reactions/delete`,
              { value: args.value },
            );

            logger.info('Removed reaction', { kind, entityId, value: args.value });

            const aorpResult = createAorpResponse(
              'remove',
              result?.message ?? `Reaction "${args.value}" removed from ${kind} ${entityId}`,
              {},
              { success: true, metadata: { count: 1 } },
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
        logger.error('Reactions operation failed', {
          error,
          subcommand,
          kind,
          entityId: args.entityId,
        });

        if (error instanceof MCPError) {
          const statusCode = error.details?.statusCode;
          if (statusCode === 403) {
            throw new MCPError(
              ErrorCode.PERMISSION_DENIED,
              `You do not have access to reactions on ${kind} ${args.entityId}.`,
            );
          }
          throw error;
        }

        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `Reactions operation failed: ${error.message}`);
        }

        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during a reactions operation',
        );
      }
    },
  );
}
