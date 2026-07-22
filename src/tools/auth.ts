/**
 * Authentication Tool
 * Handles authentication operations for Vikunja
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import type { VikunjaCapabilities } from '../types/vikunja';
import { MCPError, ErrorCode } from '../types/errors';
import { clearGlobalClientFactory } from '../client';
import { logger } from '../utils/logger';
import { applyRateLimiting } from '../middleware/direct-middleware';
import { createSecureConnectionMessage } from '../utils/security';
import { wrapAuthError } from '../utils/error-handler';
import { createStandardResponse } from '../utils/response-factory';
import { formatMcpResponse } from '../utils/simple-response';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { getOrDetectCapabilities } from '../utils/capabilities';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

interface AuthArgs {
  subcommand: 'connect' | 'status' | 'refresh' | 'disconnect' | 'info';
  apiUrl?: string | undefined;
  apiToken?: string | undefined;
}

/**
 * Shape of `GET /info` (`shared.VikunjaInfos` per the OpenAPI spec). Only the
 * fields this tool actually surfaces are declared; the endpoint returns
 * several more (motd, legal, enabled_pro_features, ...) that pass through
 * untouched via the index signature for the 'info' subcommand's full-payload
 * response.
 */
interface VikunjaInfoResponse {
  version?: string;
  frontend_url?: string;
  [key: string]: unknown;
}

/**
 * Verifies a freshly-connected session actually works, per the audit finding
 * that 'connect' previously never contacted the server (bad URL/token only
 * surfaced on the first real tool call — see docs/API-COVERAGE.md, "Auth,
 * API tokens, and service/meta info", MEDIUM severity).
 *
 * Two round trips, in order:
 * 1. `GET /info` — documented as requiring no authentication, so a failure
 *    here means the URL itself is unreachable/wrong (DNS, connection
 *    refused, wrong path, non-Vikunja server), independent of credentials.
 *    Also returns the server version, surfaced in the connect response.
 * 2. A cheap authenticated call to validate the credential itself. JWTs are
 *    verified against `GET /user`; API tokens (`tk_*`) cannot use `/user`
 *    (per docs/VIKUNJA_API_ISSUES.md #2, user-scoped endpoints reject `tk_`
 *    tokens even when valid) so `GET /projects` with `per_page=1` is used
 *    instead — a minimal authenticated call that both token types accept.
 *
 * On failure of either step, the caller's freshly-created session is rolled
 * back (`authManager.disconnect()`) so a failed 'connect' does not leave a
 * broken session behind, and a clear, actionable MCPError is thrown.
 *
 * Once both round trips succeed, this also runs (and caches on the session)
 * the one-time capability/version detection described in
 * `src/utils/capabilities.ts` — the `GET /info` payload already fetched
 * above plus a best-effort `GET /api/v2/openapi.json` probe. This is
 * read-only groundwork for a future v2 migration: it never throws (a failed
 * probe just caches `hasV2Api: false`) and doesn't change what `connect`
 * requires to succeed.
 */
async function verifyConnection(
  authManager: AuthManager,
  apiUrl: string,
  authType: 'api-token' | 'jwt',
): Promise<VikunjaCapabilities> {
  let info: VikunjaInfoResponse;
  try {
    info = await vikunjaRestRequest<VikunjaInfoResponse>(authManager, 'GET', '/info');
  } catch (error) {
    authManager.disconnect();
    throw new MCPError(
      ErrorCode.AUTH_REQUIRED,
      `Could not reach a Vikunja server at ${apiUrl}: ${
        error instanceof Error ? error.message : String(error)
      }. Check the URL (it should point at the API, e.g. .../api/v1) and network connectivity.`,
    );
  }

  try {
    if (authType === 'jwt') {
      await vikunjaRestRequest(authManager, 'GET', '/user');
    } else {
      await vikunjaRestRequest(authManager, 'GET', '/projects?per_page=1');
    }
  } catch (error) {
    authManager.disconnect();
    throw new MCPError(
      ErrorCode.AUTH_REQUIRED,
      `Vikunja server at ${apiUrl} was reachable, but the provided ${
        authType === 'jwt' ? 'JWT' : 'API'
      } token was rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return getOrDetectCapabilities(authManager, info);
}

export function registerAuthTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_auth',
    withReadOnlyNote(
      'vikunja_auth',
      'Manage authentication with Vikunja API (connect, status, refresh, disconnect, info)',
    ),
    {
      subcommand: z.enum(['connect', 'status', 'refresh', 'disconnect', 'info']),
      apiUrl: z.string().url().optional(),
      apiToken: z.string().optional(),
    },
    getToolAnnotations('vikunja_auth'),
    applyRateLimiting('vikunja_auth', async (args: AuthArgs) => {
      try {
        assertWriteAllowed('vikunja_auth', args.subcommand);
        switch (args.subcommand) {
          case 'connect': {
            if (!args.apiUrl || !args.apiToken) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'apiUrl and apiToken are required for connect',
              );
            }

            const secureMessage = createSecureConnectionMessage(args.apiUrl, args.apiToken);
            logger.debug('Auth connect attempt: %s', secureMessage);

            // Check if already authenticated
            const currentStatus = authManager.getStatus();
            if (currentStatus.authenticated && currentStatus.apiUrl === args.apiUrl) {
              const response = createStandardResponse(
                'auth-connect',
                'Already connected to Vikunja',
                { authenticated: true },
                { apiUrl: args.apiUrl },
              );
              return {
                content: formatMcpResponse(response),
              };
            }

            // Auto-detect auth type will be handled by AuthManager
            logger.info('Attempting to connect to Vikunja');
            authManager.connect(args.apiUrl, args.apiToken);
            const detectedAuthType = authManager.getAuthType();
            logger.info('Successfully connected to Vikunja - authType: %s', detectedAuthType);

            // Verify the connection actually works before reporting success —
            // see verifyConnection()'s doc comment for why this is a
            // two-step round trip (unauthenticated /info, then a cheap
            // authenticated call), plus the one-time capability/version
            // detection cached on the session. Throws (and rolls back the
            // session) on failure of either round trip.
            const capabilities = await verifyConnection(authManager, args.apiUrl, detectedAuthType);

            const response = createStandardResponse(
              'auth-connect',
              'Successfully connected to Vikunja',
              { authenticated: true },
              {
                apiUrl: args.apiUrl,
                authType: authManager.getAuthType(),
                ...(capabilities.serverVersion !== undefined
                  ? { serverVersion: capabilities.serverVersion }
                  : {}),
              },
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'status': {
            const status = authManager.getStatus();
            const response = createStandardResponse(
              'auth-status',
              status.authenticated ? 'Authentication status retrieved' : 'Not authenticated',
              status,
              status.authenticated ? { apiUrl: status.apiUrl } : undefined,
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'refresh': {
            // authManager.getAuthType() throws AUTH_REQUIRED when there is
            // no active session, which wrapAuthError below turns into a
            // clear "not authenticated" error.
            const authType = authManager.getAuthType();

            if (authType === 'jwt') {
              // Vikunja JWTs are short-lived (unlike API tokens) and the
              // spec documents POST /user/token/refresh to renew one. That
              // endpoint exchanges a refresh-token cookie set at login for
              // a new JWT -- but this server authenticates every request
              // with a single static Bearer token supplied via
              // vikunja_auth.connect and never establishes a cookie-based
              // session, so it has no refresh-token cookie to send. The
              // endpoint is therefore not usable from this server: calling
              // it would just fail with 401 "invalid or expired refresh
              // token". Report that accurately instead of attempting (and
              // silently failing) the call or claiming refresh isn't
              // needed.
              const response = createStandardResponse(
                'auth-refresh',
                'JWT tokens expire and this server cannot refresh them automatically. Vikunja\'s POST /user/token/refresh endpoint requires a refresh-token cookie issued at login, but this server authenticates with a static Bearer token and holds no such cookie. When your JWT expires, obtain a new one (e.g. by logging in to Vikunja again) and call vikunja_auth connect with the new token.',
                { refreshed: false, authType: 'jwt', tokenExpires: true },
                {
                  reason:
                    'JWT refresh requires a refresh-token cookie this static-Bearer-token server does not have',
                },
              );
              return {
                content: formatMcpResponse(response),
              };
            }

            // API tokens (tk_*) are documented as long-lived and have no
            // refresh mechanism in the API, so this message remains accurate.
            const response = createStandardResponse(
              'auth-refresh',
              'Token refresh not required for API tokens (tk_*) - they are long-lived and do not expire.',
              { refreshed: false, authType: 'api-token', tokenExpires: false },
              { reason: 'API tokens do not expire' },
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'disconnect': {
            authManager.disconnect();
            await clearGlobalClientFactory();
            const response = createStandardResponse(
              'auth-disconnect',
              'Successfully disconnected from Vikunja',
              { authenticated: false },
              { previouslyConnected: true },
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'info': {
            // GET /info needs no auth server-side, but this subcommand
            // still requires an active session (like 'refresh') so it has a
            // server URL to ask.
            if (!authManager.isAuthenticated()) {
              throw new MCPError(
                ErrorCode.AUTH_REQUIRED,
                'Authentication required. Please use vikunja_auth.connect first.',
              );
            }
            const info = await vikunjaRestRequest<VikunjaInfoResponse>(
              authManager,
              'GET',
              '/info',
            );

            // Refreshes the info-derived capability fields from this fresh
            // /info response while reusing the cached hasV2Api probe result
            // (or, for a session that never went through 'connect's
            // detection, running it once now) — see
            // `getOrDetectCapabilities` in `src/utils/capabilities.ts`.
            const capabilities = await getOrDetectCapabilities(authManager, info);

            const response = createStandardResponse(
              'auth-info',
              'Vikunja server info retrieved successfully',
              { info },
              {
                ...(capabilities.serverVersion !== undefined
                  ? { serverVersion: capabilities.serverVersion }
                  : {}),
                hasV2Api: capabilities.hasV2Api,
              },
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${args.subcommand as string}`,
            );
        }
      } catch (error) {
        throw wrapAuthError(error, args.subcommand);
      }
    })
  );
}
