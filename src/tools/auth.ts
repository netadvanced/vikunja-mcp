/**
 * Authentication Tool
 * Handles authentication operations for Vikunja
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types/errors';
import { clearGlobalClientFactory, getAuthManagerFromContext, hasRequestContext } from '../client';
import { getCurrentIdentity, type Identity } from '../context/requestContext';
import { getActiveVaultStore } from '../storage/vaultFileStore';
import { logger } from '../utils/logger';
import { applyRateLimiting } from '../middleware/direct-middleware';
import { createSecureConnectionMessage, maskCredential } from '../utils/security';
import { wrapAuthError } from '../utils/error-handler';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { createStandardResponse } from '../utils/response-factory';
import { formatMcpResponse } from '../utils/simple-response';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

interface AuthArgs {
  subcommand: 'connect' | 'status' | 'refresh' | 'disconnect' | 'info' | 'provision' | 'deprovision';
  apiUrl?: string | undefined;
  apiToken?: string | undefined;
  vikunjaUrl?: string | undefined;
}

/**
 * The oidc-http-mode-only error for a provisioning subcommand called outside
 * an ALS request context (i.e. `stdio` mode, or somehow a non-oidc `http`
 * request — structurally shouldn't happen, but defensive either way).
 * Provisioning is meaningless in `stdio` mode: there is only ever one
 * process-wide credential, set via `connect`, and no per-identity vault to
 * link one into (docs/OIDC-RESOURCE-SERVER.md §3c, D7).
 */
function createStdioModeProvisioningError(subcommand: string): MCPError {
  return new MCPError(
    ErrorCode.NOT_IMPLEMENTED,
    `vikunja_auth ${subcommand} is an oidc-http mode feature — it links your validated ` +
      `OIDC identity to a Vikunja API token in the server's credential vault. This server ` +
      `is running in stdio mode, which has only one process-wide credential; use ` +
      `vikunja_auth connect instead.`,
  );
}

/** The current request's validated identity, or throws if somehow called outside an ALS scope. */
function requireCurrentIdentity(): Identity {
  const identity = getCurrentIdentity();
  if (!identity) {
    throw new MCPError(
      ErrorCode.INTERNAL_ERROR,
      'No validated identity is available for this request (expected an oidc-http ALS request context).',
    );
  }
  return identity;
}

/** The active vault store, or throws a clear internal error if oidc-http mode somehow has none registered. */
function requireActiveVault(): NonNullable<ReturnType<typeof getActiveVaultStore>> {
  const vault = getActiveVaultStore();
  if (!vault) {
    throw new MCPError(
      ErrorCode.INTERNAL_ERROR,
      'The credential vault is not initialized. This is a server configuration bug — ' +
        'oidc-http mode should refuse to start without one (see setupOidcHttpAuth).',
    );
  }
  return vault;
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
 */
async function verifyConnection(
  authManager: AuthManager,
  apiUrl: string,
  authType: 'api-token' | 'jwt',
): Promise<string | undefined> {
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

  return typeof info.version === 'string' ? info.version : undefined;
}

export function registerAuthTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_auth',
    withReadOnlyNote(
      'vikunja_auth',
      'Manage authentication with Vikunja API (connect, status, refresh, disconnect, info). ' +
        'In oidc-http mode, self-service credential provisioning (provision, status, ' +
        'deprovision) additionally links your validated OIDC identity to a Vikunja API ' +
        "token in the server's encrypted credential vault — connect/disconnect are not " +
        'available in that mode (provision/deprovision replace them).',
    ),
    {
      subcommand: z.enum([
        'connect',
        'status',
        'refresh',
        'disconnect',
        'info',
        'provision',
        'deprovision',
      ]),
      apiUrl: z.string().url().optional(),
      apiToken: z.string().optional(),
      vikunjaUrl: z
        .string()
        .url()
        .optional()
        .describe(
          'oidc-http mode only (provision): the Vikunja base URL to associate with the ' +
            "linked token. Defaults to the server's configured shared VIKUNJA_URL when omitted.",
        ),
    },
    getToolAnnotations('vikunja_auth'),
    applyRateLimiting('vikunja_auth', async (args: AuthArgs) => {
      try {
        assertWriteAllowed('vikunja_auth', args.subcommand);
        switch (args.subcommand) {
          case 'connect': {
            if (hasRequestContext()) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'vikunja_auth connect is not available in oidc-http mode — there is no ' +
                  'single server-wide token to connect. Use vikunja_auth provision instead ' +
                  'to link your own Vikunja API token to your authenticated identity.',
              );
            }
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
            // authenticated call). Throws (and rolls back the session) on
            // failure.
            const serverVersion = await verifyConnection(authManager, args.apiUrl, detectedAuthType);

            const response = createStandardResponse(
              'auth-connect',
              'Successfully connected to Vikunja',
              { authenticated: true },
              {
                apiUrl: args.apiUrl,
                authType: authManager.getAuthType(),
                ...(serverVersion !== undefined ? { serverVersion } : {}),
              },
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'status': {
            // oidc-http mode: report the CALLING identity's own vault status
            // — never another identity's, never the process-global session
            // (there isn't a meaningful one in this mode). `stdio` mode
            // (no ALS context) falls through to the pre-existing
            // connect-based session status, unchanged.
            if (hasRequestContext()) {
              const identity = requireCurrentIdentity();
              const vault = getActiveVaultStore();
              const vaultStatus = vault?.getStatus(identity) ?? { provisioned: false };
              const response = createStandardResponse(
                'auth-status',
                vaultStatus.provisioned
                  ? 'Vikunja API token linked'
                  : 'No Vikunja API token linked yet — run vikunja_auth provision',
                vaultStatus,
                vaultStatus.provisioned ? { apiUrl: vaultStatus.vikunjaUrl } : undefined,
              );
              return {
                content: formatMcpResponse(response),
              };
            }

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
            // oidc-http mode: 'disconnect' aliases 'deprovision' — there is
            // no process-global session to disconnect in this mode (D7).
            if (hasRequestContext()) {
              const identity = requireCurrentIdentity();
              const vault = requireActiveVault();
              const existed = await vault.deprovision(identity);
              const response = createStandardResponse(
                'auth-disconnect',
                existed
                  ? 'Deprovisioned your linked Vikunja API token'
                  : 'No linked Vikunja API token to remove',
                { authenticated: false },
                { previouslyProvisioned: existed },
              );
              return {
                content: formatMcpResponse(response),
              };
            }

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
            // server URL to ask. Closure-gate precedence fix: defer to the
            // per-request context when bound (see hasRequestContext's doc
            // comment, src/client.ts).
            if (hasRequestContext()) {
              await getAuthManagerFromContext();
            } else if (!authManager.isAuthenticated()) {
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

            const response = createStandardResponse(
              'auth-info',
              'Vikunja server info retrieved successfully',
              { info },
              typeof info.version === 'string' ? { serverVersion: info.version } : undefined,
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'provision': {
            if (!hasRequestContext()) {
              throw createStdioModeProvisioningError('provision');
            }
            if (!args.apiToken) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'apiToken is required for provision — create one in Vikunja → Settings → API Tokens.',
              );
            }
            const identity = requireCurrentIdentity();
            const vikunjaUrl =
              args.vikunjaUrl ?? ConfigurationManager.getInstance().loadConfiguration().auth.vikunjaUrl;
            if (!vikunjaUrl) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'No Vikunja URL is configured for this server. Pass vikunjaUrl explicitly, ' +
                  'or have the operator set VIKUNJA_URL.',
              );
            }

            // Validate the token BEFORE storing it — sub/issuer always come
            // from the validated identity above, NEVER from args (D7). This
            // reuses the exact same round-trip 'connect' already performs
            // (GET /info, then a cheap authenticated probe).
            const throwaway = new AuthManager();
            throwaway.connect(vikunjaUrl, args.apiToken);
            const serverVersion = await verifyConnection(throwaway, vikunjaUrl, 'api-token');

            const vault = requireActiveVault();
            await vault.provision(identity, vikunjaUrl, args.apiToken);

            const response = createStandardResponse(
              'auth-provision',
              'Linked your Vikunja API token',
              { linked: true },
              {
                apiUrl: vikunjaUrl,
                maskedToken: maskCredential(args.apiToken),
                ...(serverVersion !== undefined ? { serverVersion } : {}),
              },
            );
            return {
              content: formatMcpResponse(response),
            };
          }

          case 'deprovision': {
            if (!hasRequestContext()) {
              throw createStdioModeProvisioningError('deprovision');
            }
            const identity = requireCurrentIdentity();
            const vault = requireActiveVault();
            const existed = await vault.deprovision(identity);
            const response = createStandardResponse(
              'auth-deprovision',
              existed
                ? 'Deprovisioned your linked Vikunja API token'
                : 'No linked Vikunja API token to remove',
              { deprovisioned: true },
              { previouslyProvisioned: existed },
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
