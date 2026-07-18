/**
 * Instance Admin Tool
 *
 * Covers the Vikunja OpenAPI spec's `/admin/*` operations: instance overview,
 * every-project listing + owner reassignment, and instance-wide user
 * management (list/create/delete, admin-flag toggle, status change).
 *
 * Reserved behind TWO gates, both of which must allow the call (module
 * config can only narrow auth, never expand it — see
 * src/tools/index.ts):
 * 1. The deny-by-default `admin` module config key (see
 *    src/config/types.ts DANGEROUS_MODULE_KEYS) — an operator must
 *    explicitly opt in before this tool is even registered.
 * 2. JWT-only auth gating, matching the existing `users`/`export` precedent
 *    (src/tools/index.ts) — API-token sessions never see this tool
 *    registered, regardless of the `admin` config value.
 *
 * `delete-user` additionally requires an explicit `confirm: true` argument
 * (see docs/ENDPOINT-PLAYBOOK.md §7 honesty-in-descriptions convention) —
 * account deletion is irreversible in 'now' mode and cannot be undone by
 * this tool.
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

/** `shared.AdminUser` per the OpenAPI spec. */
export interface AdminUser {
  id?: number;
  username?: string;
  email?: string;
  name?: string;
  is_admin?: boolean;
  status?: number;
  auth_provider?: string;
  issuer?: string;
  subject?: string;
  bot_owner_id?: number;
  created?: string;
  updated?: string;
}

/** `models.Overview` per the OpenAPI spec. */
export interface AdminOverview {
  users?: number;
  projects?: number;
  tasks?: number;
  teams?: number;
  shares?: unknown;
  license?: unknown;
}

// user.Status enum per the OpenAPI spec (x-enum-varnames):
// 0 StatusActive, 1 StatusEmailConfirmationRequired, 2 StatusDisabled, 3 StatusAccountLocked.
// The MCP interface accepts readable string literals and converts to the
// numeric wire value, matching the repeatMode/repeatAfter convention
// documented in docs/API_NOTES.md.
const USER_STATUS_MAP: Record<string, number> = {
  active: 0,
  'email-confirmation-required': 1,
  disabled: 2,
  'account-locked': 3,
};

export function registerAdminTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_admin',
    withReadOnlyNote(
      'vikunja_admin',
      "Instance-admin operations: overview, list every project, reassign a project's owner, list/create/delete users, and toggle a user's admin flag or status. Reserved/deny-by-default: only registered when the 'admin' module config key is explicitly enabled AND the session is JWT-authenticated (API-token sessions never see this tool, regardless of config). 'delete-user' is irreversible in 'now' mode and requires an explicit confirm: true argument.",
    ),
    {
      subcommand: z.enum([
        'overview',
        'list-projects',
        'set-project-owner',
        'list-users',
        'create-user',
        'delete-user',
        'set-user-admin',
        'set-user-status',
      ]),

      // list-projects / list-users pagination + search
      page: z.number().int().positive().optional(),
      perPage: z.number().int().positive().max(100).optional(),
      search: z.string().optional(),

      // set-project-owner
      projectId: z.number().int().positive().optional(),
      ownerId: z.number().int().positive().optional(),

      // create-user
      username: z.string().min(3).max(250).optional(),
      email: z.string().email().max(250).optional(),
      password: z.string().min(8).max(72).optional(),
      name: z.string().optional(),
      language: z.string().optional(),
      isAdmin: z.boolean().optional(),
      skipEmailConfirm: z.boolean().optional(),

      // delete-user / set-user-admin / set-user-status
      userId: z.number().int().positive().optional(),
      mode: z.enum(['now', 'scheduled']).optional(),
      confirm: z
        .boolean()
        .optional()
        .describe('Must be true to perform delete-user — this operation is irreversible in "now" mode.'),
      status: z
        .enum(['active', 'email-confirmation-required', 'disabled', 'account-locked'])
        .optional(),
    },
    getToolAnnotations('vikunja_admin'),
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }
      if (authManager.getAuthType() !== 'jwt') {
        throw new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'Admin operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        );
      }

      const subcommand = args.subcommand;

      assertWriteAllowed('vikunja_admin', subcommand);

      logger.debug('Admin tool called', { subcommand });

      try {
        switch (subcommand) {
          case 'overview': {
            const overview = await vikunjaRestRequest<AdminOverview>(
              authManager,
              'GET',
              '/admin/overview',
            );

            logger.info('Retrieved admin overview');

            const aorpResult = createAorpResponse(
              'overview',
              'Retrieved instance admin overview',
              { overview },
              { success: true },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'list-projects': {
            const query = new URLSearchParams();
            if (args.page !== undefined) query.set('page', String(args.page));
            if (args.perPage !== undefined) query.set('per_page', String(args.perPage));
            if (args.search !== undefined) query.set('s', args.search);
            const qs = query.toString();

            const projects =
              (await vikunjaRestRequest<unknown[]>(
                authManager,
                'GET',
                `/admin/projects${qs ? `?${qs}` : ''}`,
              )) ?? [];

            logger.info('Listed all instance projects (admin)', { count: projects.length });

            const aorpResult = createAorpResponse(
              'list-projects',
              `Retrieved ${projects.length} projects instance-wide`,
              { allProjects: projects },
              { success: true, metadata: { count: projects.length } },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'set-project-owner': {
            const projectId = validateAndConvertId(args.projectId, 'projectId');
            const ownerId = validateAndConvertId(args.ownerId, 'ownerId');

            const project = await vikunjaRestRequest(
              authManager,
              'PATCH',
              `/admin/projects/${projectId}/owner`,
              { owner_id: ownerId },
            );

            logger.info('Reassigned project owner (admin)', { projectId, ownerId });

            const aorpResult = createAorpResponse(
              'set-project-owner',
              `Project ${projectId} owner reassigned to user ${ownerId}`,
              { project },
              { success: true },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'list-users': {
            const query = new URLSearchParams();
            if (args.search !== undefined) query.set('s', args.search);
            if (args.page !== undefined) query.set('page', String(args.page));
            if (args.perPage !== undefined) query.set('per_page', String(args.perPage));
            const qs = query.toString();

            const users =
              (await vikunjaRestRequest<AdminUser[]>(
                authManager,
                'GET',
                `/admin/users${qs ? `?${qs}` : ''}`,
              )) ?? [];

            logger.info('Listed all instance users (admin)', { count: users.length });

            const aorpResult = createAorpResponse(
              'list-users',
              `Retrieved ${users.length} users instance-wide`,
              { allUsers: users },
              { success: true, metadata: { count: users.length } },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'create-user': {
            if (!args.username || !args.email || !args.password) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'username, email, and password are required for create-user',
              );
            }

            const body: Record<string, unknown> = {
              username: args.username,
              email: args.email,
              password: args.password,
            };
            if (args.name !== undefined) body.name = args.name;
            if (args.language !== undefined) body.language = args.language;
            if (args.isAdmin !== undefined) body.is_admin = args.isAdmin;
            if (args.skipEmailConfirm !== undefined) body.skip_email_confirm = args.skipEmailConfirm;

            const user = await vikunjaRestRequest<AdminUser>(authManager, 'POST', '/admin/users', body);

            logger.info('Created user (admin)', { userId: user.id, username: user.username });

            const aorpResult = createAorpResponse(
              'create-user',
              `User '${user.username ?? args.username}' created successfully`,
              { user },
              { success: true, metadata: { count: 1 } },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'delete-user': {
            const userId = validateAndConvertId(args.userId, 'userId');

            if (args.confirm !== true) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'Deleting a user is irreversible (in "now" mode). Pass confirm: true to proceed.',
              );
            }

            const query = new URLSearchParams();
            if (args.mode !== undefined) query.set('mode', args.mode);
            const qs = query.toString();

            await vikunjaRestRequest(authManager, 'DELETE', `/admin/users/${userId}${qs ? `?${qs}` : ''}`);

            logger.info('Deleted user (admin)', { userId, mode: args.mode ?? 'scheduled' });

            const aorpResult = createAorpResponse(
              'delete-user',
              `User ${userId} deletion ${args.mode === 'now' ? 'completed immediately' : 'scheduled (confirmation email sent)'}`,
              { userId, mode: args.mode ?? 'scheduled' },
              { success: true },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'set-user-admin': {
            const userId = validateAndConvertId(args.userId, 'userId');
            if (args.isAdmin === undefined) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'isAdmin is required for set-user-admin',
              );
            }

            const user = await vikunjaRestRequest<AdminUser>(
              authManager,
              'PATCH',
              `/admin/users/${userId}/admin`,
              { is_admin: args.isAdmin },
            );

            logger.info('Set user admin flag (admin)', { userId, isAdmin: args.isAdmin });

            const aorpResult = createAorpResponse(
              'set-user-admin',
              `User ${userId} admin flag set to ${args.isAdmin}`,
              { user },
              { success: true },
            );
            return { content: [{ type: 'text' as const, text: aorpResult.content }] };
          }

          case 'set-user-status': {
            const userId = validateAndConvertId(args.userId, 'userId');
            if (!args.status) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'status is required for set-user-status (one of: active, email-confirmation-required, disabled, account-locked)',
              );
            }

            const user = await vikunjaRestRequest<AdminUser>(
              authManager,
              'PATCH',
              `/admin/users/${userId}/status`,
              { status: USER_STATUS_MAP[args.status] },
            );

            logger.info('Set user status (admin)', { userId, status: args.status });

            const aorpResult = createAorpResponse(
              'set-user-status',
              `User ${userId} status set to ${args.status}`,
              { user },
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
        logger.error('Admin operation failed', { error, subcommand });

        if (error instanceof MCPError) {
          throw error;
        }
        if (error instanceof Error) {
          throw new MCPError(ErrorCode.API_ERROR, `Admin operation failed: ${error.message}`);
        }
        throw new MCPError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred during admin operation');
      }
    },
  );
}
