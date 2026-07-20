/**
 * User Self-Deletion Tool
 *
 * Covers the Vikunja OpenAPI spec's `/user/deletion/*` operations: request,
 * confirm, and cancel the deletion of the CURRENTLY AUTHENTICATED account.
 * This is the reserved slot the `userDeletion` deny-by-default module config
 * key (see src/config/types.ts DANGEROUS_MODULE_KEYS) was set aside for —
 * before this tool, the key existed but nothing was wired to it.
 *
 * Reserved behind TWO gates, both of which must allow the call (module
 * config can only narrow auth, never expand it — see src/tools/index.ts,
 * matching the existing `admin`/`users`/`export` precedent):
 * 1. The deny-by-default `userDeletion` module config key — an operator
 *    must explicitly opt in before this tool is even registered.
 * 2. JWT-only auth gating: per docs/VIKUNJA_API_ISSUES.md, ALL `/user/*`
 *    endpoints reject `tk_*` API tokens server-side and require a JWT
 *    session. API-token sessions never see this tool registered,
 *    regardless of the `userDeletion` config value.
 *
 * `request` and `confirm` additionally require an explicit `confirm: true`
 * tool argument (mirroring `vikunja_admin`'s `delete-user` pattern) — both
 * legs move the account irreversibly closer to deletion once Vikunja's
 * email-confirmation flow completes. `cancel` is the safe "undo" leg and
 * does NOT require `confirm: true`.
 *
 * SECRETS: `password` (request/cancel) and `token` (confirm, delivered by
 * email — the caller supplies it, this tool never fetches or sees the
 * email itself) are credentials. Neither is ever included in a response or
 * error message here: success responses only echo the server's generic
 * confirmation message (`models.Message.message`, which Vikunja itself
 * never populates with the submitted credential), and the request body is
 * never interpolated into any thrown error text. See src/utils/security.ts
 * for the shared masking conventions — `logger.debug` below intentionally
 * logs only the subcommand (never `args`), so neither secret can reach logs
 * even incidentally.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { getAuthManagerFromContext, hasRequestContext } from '../client';
import { MCPError, ErrorCode } from '../types';
import { logger } from '../utils/logger';
import { createAorpResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

/** `models.Message` per the OpenAPI spec — every `/user/deletion/*` response shape. */
interface VikunjaMessageResponse {
  message?: string;
}

export function registerUserDeletionTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_user_deletion',
    withReadOnlyNote(
      'vikunja_user_deletion',
      "Request, confirm, or cancel deletion of the CURRENTLY AUTHENTICATED Vikunja account. Reserved/deny-by-default: only registered when the 'userDeletion' module config key is explicitly enabled AND the session is JWT-authenticated (API-token sessions never see this tool, regardless of config). 'request' asks the server to start the deletion and sends a confirmation email; 'confirm' (given the token from that email) irreversibly proceeds with deletion; both require an explicit confirm: true argument. 'cancel' aborts an in-progress deletion request and does NOT require confirm: true — it is the safe undo.",
    ),
    {
      subcommand: z.enum(['request', 'confirm', 'cancel']),

      // request / cancel
      password: z
        .string()
        .min(1)
        .optional()
        .describe('The account password. Required for request and cancel.'),

      // confirm — the token Vikunja emailed to the account owner.
      token: z
        .string()
        .min(1)
        .optional()
        .describe('The deletion-confirmation token delivered by email. Required for confirm.'),

      confirm: z
        .boolean()
        .optional()
        .describe(
          'Must be true to perform request or confirm. Account deletion is scheduled and irreversible once the emailed token is confirmed. Not required for cancel.',
        ),
    },
    getToolAnnotations('vikunja_user_deletion'),
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
      if (authManager.getAuthType() !== 'jwt') {
        throw new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'User deletion operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        );
      }

      const subcommand = args.subcommand;

      assertWriteAllowed('vikunja_user_deletion', subcommand);

      logger.debug('User deletion tool called', { subcommand });

      try {
        switch (subcommand) {
          case 'request': {
            if (args.confirm !== true) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'Requesting account deletion starts an irreversible process: Vikunja will email a confirmation token, and confirming it schedules the account for deletion. Pass confirm: true to proceed.',
              );
            }
            if (!args.password) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'password is required for the request subcommand',
              );
            }

            const result = await vikunjaRestRequest<VikunjaMessageResponse>(
              authManager,
              'POST',
              '/user/deletion/request',
              { password: args.password },
            );

            logger.info('Requested account deletion');

            const aorpResult = createAorpResponse(
              'request',
              'Account deletion requested. Vikunja has emailed a confirmation token — pass it to the confirm subcommand (with confirm: true) to proceed. The deletion is irreversible once confirmed; use the cancel subcommand beforehand to abort.',
              { serverMessage: result?.message ?? null },
              { success: true },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'confirm': {
            if (args.confirm !== true) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'Confirming account deletion is irreversible: the account is scheduled for deletion once confirmed. Pass confirm: true to proceed.',
              );
            }
            if (!args.token) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'token is required for the confirm subcommand (the token Vikunja emailed after request)',
              );
            }

            const result = await vikunjaRestRequest<VikunjaMessageResponse>(
              authManager,
              'POST',
              '/user/deletion/confirm',
              { token: args.token },
            );

            logger.info('Confirmed account deletion');

            const aorpResult = createAorpResponse(
              'confirm',
              'Account deletion confirmed. The account is now scheduled for deletion; this is irreversible.',
              { serverMessage: result?.message ?? null },
              { success: true },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'cancel': {
            if (!args.password) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'password is required for the cancel subcommand',
              );
            }

            const result = await vikunjaRestRequest<VikunjaMessageResponse>(
              authManager,
              'POST',
              '/user/deletion/cancel',
              { password: args.password },
            );

            logger.info('Canceled account deletion request');

            const aorpResult = createAorpResponse(
              'cancel',
              'Account deletion request canceled. The account will not be deleted.',
              { serverMessage: result?.message ?? null },
              { success: true },
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
        logger.error('User deletion operation failed', { error, subcommand });

        if (error instanceof MCPError) {
          throw error;
        }
        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `User deletion operation failed: ${error.message}`);
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during user deletion operation',
        );
      }
    },
  );
}
