/**
 * CalDAV Token Management Tool
 *
 * Manages the current user's Vikunja CalDAV tokens (`GET/PUT
 * /user/settings/token/caldav`, `DELETE /user/settings/token/caldav/{id}`
 * per the vendored OpenAPI spec, docs/vikunja-openapi.json). These tokens
 * authenticate third-party CalDAV clients against Vikunja's CalDAV
 * interface — a separate credential from both JWT sessions and the
 * `/tokens` API tokens managed by `vikunja_tokens`.
 *
 * Reserved behind the deny-by-default `caldavTokens` module config key (see
 * src/config/types.ts DANGEROUS_MODULE_KEYS) because it is credential-
 * adjacent: an operator must explicitly opt in before an AI assistant can
 * mint or revoke CalDAV tokens for the connected account.
 *
 * Unlike `tokenManagement`, every `/user/settings/token/caldav*` operation
 * in the vendored spec is scoped `security: [{"JWTKeyAuth": []}]` only (no
 * `APIKeyAuth` entry) — the same JWT-only pattern as `/user/export*` and the
 * other `/user/settings/*` endpoints. Registration therefore composes the
 * `caldavTokens` module gate with the same JWT-authenticated check used for
 * `vikunja_users`/`vikunja_export_*`/`vikunja_admin` (see
 * src/tools/index.ts), rather than registering unconditionally like
 * `vikunja_tokens` does.
 *
 * `create`'s response includes the token's secret value exactly once — per
 * the spec's own description ("It is not possible to see the token again
 * after it was generated") — surfaced the same way `vikunja_tokens create`
 * surfaces a new API token's secret: a clear "store this now" note.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { getAuthManagerFromContext, hasRequestContext } from '../client';
import { MCPError, ErrorCode } from '../types';
import { logger } from '../utils/logger';
import { validateAndConvertId } from '../utils/validation';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

/**
 * `user.Token` per the OpenAPI spec. `token` (the actual secret value) is
 * only ever present in the `create` response — the `list` response only
 * ever returns `id`/`created` (per the spec's own summary: "Return the IDs
 * and created dates of all caldav tokens for the current user").
 */
export interface CaldavToken {
  id?: number;
  created?: string;
  token?: string;
}

export function registerCaldavTokensTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_caldav_tokens',
    withReadOnlyNote(
      'vikunja_caldav_tokens',
      "Manage the current user's Vikunja CalDAV tokens (list, create, delete) — separate credentials from API tokens (vikunja_tokens), used to authenticate third-party CalDAV clients against Vikunja's CalDAV interface. Reserved/deny-by-default: only registered when the 'caldavTokens' module config key is explicitly enabled AND the session is JWT-authenticated (the underlying endpoints are JWT-only per the OpenAPI spec). A newly-created token's secret value is only ever returned once, in the 'create' response — it cannot be retrieved again afterwards.",
    ),
    {
      subcommand: z.enum(['list', 'create', 'delete']),

      // delete
      tokenId: z.number().int().positive().optional(),
    },
    getToolAnnotations('vikunja_caldav_tokens'),
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

      const subcommand = args.subcommand;

      assertWriteAllowed('vikunja_caldav_tokens', subcommand);

      logger.debug('CalDAV tokens tool called', { subcommand });

      try {
        switch (subcommand) {
          case 'list': {
            const tokens =
              (await vikunjaRestRequest<CaldavToken[]>(
                authManager,
                'GET',
                '/user/settings/token/caldav',
              )) ?? [];

            logger.info('Listed CalDAV tokens', { count: tokens.length });

            const aorpResult = createAorpResponse(
              'list',
              `Retrieved ${tokens.length} CalDAV tokens`,
              { tokens },
              { success: true, metadata: { count: tokens.length } },
            );

            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'create': {
            const token = await vikunjaRestRequest<CaldavToken>(
              authManager,
              'PUT',
              '/user/settings/token/caldav',
            );

            logger.info('Created CalDAV token', { tokenId: token.id });

            const aorpResult = createAorpResponse(
              'create',
              'CalDAV token created successfully. Its secret value is shown only now and cannot be retrieved again — store this now, in a password manager or your CalDAV client, before it is lost.',
              { token },
              { success: true, metadata: { count: 1 } },
            );

            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'delete': {
            const tokenId = validateAndConvertId(args.tokenId, 'tokenId');

            await vikunjaRestRequest(
              authManager,
              'DELETE',
              `/user/settings/token/caldav/${tokenId}`,
            );

            logger.info('Deleted CalDAV token', { tokenId });

            const aorpResult = createAorpResponse(
              'delete',
              `CalDAV token ${tokenId} deleted successfully`,
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
        logger.error('CalDAV token operation failed', { error, subcommand });

        if (error instanceof MCPError) {
          const statusCode = error.details?.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            throw new MCPError(
              ErrorCode.API_ERROR,
              'CalDAV token management was rejected by the server. Per docs/VIKUNJA_API_ISSUES.md, user-scoped endpoints have historically required JWT authentication — try reconnecting with a JWT via vikunja_auth.connect.',
            );
          }
          throw error;
        }

        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `CalDAV token operation failed: ${error.message}`);
        }

        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during CalDAV token operation',
        );
      }
    },
  );
}
