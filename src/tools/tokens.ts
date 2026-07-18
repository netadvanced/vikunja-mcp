/**
 * API Token Management Tool
 *
 * Manages the current user's Vikunja API tokens (`GET/PUT /tokens`,
 * `DELETE /tokens/{tokenID}` per the OpenAPI spec). Reserved behind the
 * deny-by-default `tokenManagement` module config key (see
 * src/config/types.ts DANGEROUS_MODULE_KEYS) because it is credential-
 * adjacent: an operator must explicitly opt in before an AI assistant can
 * create or delete API tokens for the connected account.
 *
 * Per docs/VIKUNJA_API_ISSUES.md #2, user-scoped endpoints have historically
 * rejected `tk_*` API tokens (JWT-only), and `/tokens` shares the same
 * security scheme as those endpoints in the spec. This tool is still
 * registered for API-token sessions (the tokenManagement config key is the
 * only registration-time gate — see docs/ENDPOINT-PLAYBOOK.md and the Wave D
 * item this shipped in), but a call made with an API-token session may be
 * rejected by the server; the 401/403 branch below surfaces that plainly
 * rather than pretending it always works.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { logger } from '../utils/logger';
import { validateAndConvertId } from '../utils/validation';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

/**
 * `models.APIToken` per the OpenAPI spec. `token` (the actual secret key) is
 * only ever present in the `create` response — list responses omit it.
 */
export interface ApiToken {
  id?: number;
  title?: string;
  token?: string;
  permissions?: Record<string, string[]>;
  expires_at?: string;
  owner_id?: number;
  created?: string;
}

export function registerTokensTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_tokens',
    withReadOnlyNote(
      'vikunja_tokens',
      "Manage the current user's Vikunja API tokens (list, create, delete). Reserved/deny-by-default: only registered when the 'tokenManagement' module config key is explicitly enabled, since it is credential-adjacent. A newly-created token's secret value is only ever returned once, in the 'create' response — it cannot be retrieved again afterwards.",
    ),
    {
      subcommand: z.enum(['list', 'create', 'delete']),

      // list
      page: z.number().int().positive().optional(),
      perPage: z.number().int().positive().max(100).optional(),
      search: z.string().optional(),

      // create
      title: z.string().min(1).optional(),
      permissions: z
        .record(z.array(z.string()))
        .optional()
        .describe(
          'Map of resource group to allowed actions, e.g. {"tasks":["read_all","update"]}. Valid keys/values are documented via GET /routes on the Vikunja server.',
        ),
      expiresAt: z.string().optional().describe('ISO 8601 date when the token should expire'),
      ownerId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Bot user id to create this token for; omitted defaults to the authenticated user"),

      // delete
      tokenId: z.number().int().positive().optional(),
    },
    getToolAnnotations('vikunja_tokens'),
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      const subcommand = args.subcommand;

      assertWriteAllowed('vikunja_tokens', subcommand);

      logger.debug('Tokens tool called', { subcommand, args: { ...args, permissions: undefined } });

      try {
        switch (subcommand) {
          case 'list': {
            const query = new URLSearchParams();
            if (args.page !== undefined) query.set('page', String(args.page));
            if (args.perPage !== undefined) query.set('per_page', String(args.perPage));
            if (args.search !== undefined) query.set('s', args.search);
            const qs = query.toString();

            const tokens =
              (await vikunjaRestRequest<ApiToken[]>(
                authManager,
                'GET',
                `/tokens${qs ? `?${qs}` : ''}`,
              )) ?? [];

            logger.info('Listed API tokens', { count: tokens.length });

            const aorpResult = createAorpResponse(
              'list',
              `Retrieved ${tokens.length} API tokens`,
              { tokens },
              { success: true, metadata: { count: tokens.length } },
            );

            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'create': {
            if (!args.title) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'title is required for creating an API token',
              );
            }
            if (!args.permissions || Object.keys(args.permissions).length === 0) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'permissions is required for creating an API token (e.g. {"tasks":["read_all"]})',
              );
            }

            const body: Partial<ApiToken> = {
              title: args.title,
              permissions: args.permissions,
            };
            if (args.expiresAt !== undefined) body.expires_at = args.expiresAt;
            if (args.ownerId !== undefined) body.owner_id = args.ownerId;

            const token = await vikunjaRestRequest<ApiToken>(authManager, 'PUT', '/tokens', body);

            logger.info('Created API token', { tokenId: token.id, title: token.title });

            const aorpResult = createAorpResponse(
              'create',
              `API token '${token.title ?? args.title}' created successfully. Its secret value is shown only now and cannot be retrieved again — store it securely.`,
              { token },
              { success: true, metadata: { count: 1 } },
            );

            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'delete': {
            const tokenId = validateAndConvertId(args.tokenId, 'tokenId');

            await vikunjaRestRequest(authManager, 'DELETE', `/tokens/${tokenId}`);

            logger.info('Deleted API token', { tokenId });

            const aorpResult = createAorpResponse(
              'delete',
              `API token ${tokenId} deleted successfully`,
              { tokenId },
              { success: true, metadata: { count: 1 } },
            );

            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${subcommand as string}`,
            );
        }
      } catch (error) {
        logger.error('Token operation failed', { error, subcommand });

        if (error instanceof MCPError) {
          const statusCode = error.details?.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            throw new MCPError(
              ErrorCode.API_ERROR,
              'API token management was rejected by the server. Per docs/VIKUNJA_API_ISSUES.md, user-scoped endpoints have historically required JWT authentication (tk_* API tokens are rejected) — try reconnecting with a JWT via vikunja_auth.connect.',
            );
          }
          throw error;
        }

        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `Token operation failed: ${error.message}`);
        }

        throw new MCPError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred during token operation');
      }
    },
  );
}
