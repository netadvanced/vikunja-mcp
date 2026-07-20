/**
 * OIDC HTTP-auth wiring — the integration glue that connects the three
 * separately-built wave-H1 pieces into one working request path
 * (docs/OIDC-RESOURCE-SERVER.md §3a/§3b/§3c/§3d):
 *
 *  - H1a's transport auth seam (`OidcAuthMiddleware`, `oidcMiddlewareSeam.ts`)
 *    — a `(req,res) => Promise<boolean>` gate `startHttpTransport` runs before
 *    it will serve any MCP request.
 *  - H1b's JWT validator (`createOidcJwtValidator`, `../auth/oidc/jwtValidator`)
 *    — turns an `Authorization` header into a verified `Identity`, or throws a
 *    generic `MCPError` carrying `statusCode` + `wwwAuthenticateError`.
 *  - H1c's per-identity request context (`RequestContext`,
 *    `../context/requestContext`) and credential source
 *    (`VikunjaCredentialSource`, `../auth/CredentialSource`).
 *
 * {@link createOidcHttpAuthMiddleware} is the pure, fully unit-testable core:
 * it takes an already-built validator and credential source and returns the
 * seam middleware. {@link setupOidcHttpAuth} is the production orchestration
 * that loads `jose`, builds the validator from config, and registers the
 * middleware on the seam — called from `src/index.ts` before
 * `startHttpTransport`.
 */

import type { ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OidcConfig, VaultConfig } from '../config/types';
import { createOidcJwtValidator, type OidcJwtValidator } from '../auth/oidc/jwtValidator';
import { loadJose } from '../auth/oidc/joseLoader';
import type { JoseDeps, OidcJwtValidatorConfig } from '../auth/oidc/types';
import { AuthManager } from '../auth/AuthManager';
import { VaultCredentialSource, type VikunjaCredentialSource } from '../auth/CredentialSource';
import {
  VaultFileStore,
  resolveVaultMasterKey,
  resolveVaultPath,
  setActiveVaultStore,
} from '../storage/vaultFileStore';
import { ConfigurationError } from '../config/types';
import {
  attachRequestContext,
  type Identity,
  type RequestContext,
} from '../context/requestContext';
import {
  setOidcAuthMiddleware,
  type HttpRequestWithAuth,
  type OidcAuthMiddleware,
} from './oidcMiddlewareSeam';
import { MCPError } from '../types/errors';
import { logger } from '../utils/logger';

/** Dependencies for {@link createOidcHttpAuthMiddleware}. */
export interface OidcHttpAuthDeps {
  /** H1b JWT validator: `Authorization` header -> verified identity, or throw. */
  validator: Pick<OidcJwtValidator, 'validate'>;
  /** H1c credential source: verified identity -> Vikunja credential, or `null`. */
  credentialSource: VikunjaCredentialSource;
}

/**
 * Reads the `Authorization` header value from a Node request. Node's
 * `IncomingHttpHeaders` types `authorization` as a single `string | undefined`
 * (unlike genuinely list-valued headers, duplicate `Authorization` headers are
 * not comma-joined — Node keeps the first), so no array handling is needed;
 * the validator rejects anything malformed anyway.
 */
function readAuthorizationHeader(req: HttpRequestWithAuth): string | undefined {
  const raw = req.headers['authorization'];
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Writes the generic RFC 6750 `401`/`403` failure response for a rejected
 * bearer token. Never echoes the token; the body/`WWW-Authenticate` header
 * carry only the safe, generic message + error code the validator produced.
 */
function writeAuthFailure(res: ServerResponse, error: unknown): void {
  let statusCode = 401;
  let wwwError: 'invalid_token' | 'insufficient_scope' = 'invalid_token';
  let message = 'Invalid or expired token';

  if (error instanceof MCPError) {
    if (error.details?.statusCode === 401 || error.details?.statusCode === 403) {
      statusCode = error.details.statusCode;
    }
    if (error.details?.wwwAuthenticateError) {
      wwwError = error.details.wwwAuthenticateError;
    }
    message = error.message;
  }

  if (res.headersSent) {
    return;
  }

  const payload = JSON.stringify({ error: wwwError, error_description: message });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // RFC 6750 §3: a bearer-token challenge. `error`/`error_description`
    // repeat the (generic) failure so a spec-compliant client can surface it.
    'WWW-Authenticate': `Bearer error="${wwwError}", error_description="${message}"`,
  });
  res.end(payload);
}

/**
 * Builds the transport auth-seam middleware that validates a bearer token,
 * resolves the caller's Vikunja credential, and attaches a per-identity
 * `RequestContext` for `src/transport/httpTransport.ts` to open an ALS scope
 * around `handleRequest`.
 *
 * On success it returns `true` (the transport proceeds); on a validation
 * failure it writes the `401`/`403` itself and returns `false` (the transport
 * must not proceed — the response is already complete).
 *
 * Note: a *validly authenticated* identity with no linked credential is NOT a
 * failure here — the token is genuine, so the request proceeds with an
 * unauthenticated per-identity `AuthManager`. The missing-credential state is
 * surfaced later, per tool call, as the structured `AUTH_REQUIRED` "provision"
 * prompt (`getAuthManagerFromContext`, `src/client.ts`) — so `initialize` and
 * other non-credential MCP traffic still work, and only actual tool calls
 * prompt for provisioning (docs/OIDC-RESOURCE-SERVER.md §3c).
 */
export function createOidcHttpAuthMiddleware(deps: OidcHttpAuthDeps): OidcAuthMiddleware {
  const { validator, credentialSource } = deps;

  return async (req: HttpRequestWithAuth, res: ServerResponse): Promise<boolean> => {
    let identity: Identity;
    try {
      const validated = await validator.validate(readAuthorizationHeader(req));
      // The validator's `Identity` (src/auth/oidc/types.ts) is a superset of
      // the request-context `Identity` (issuer/sub + optional
      // preferredUsername); narrow to the tenancy pair the context keys on.
      identity = { issuer: validated.issuer, sub: validated.sub };
    } catch (error) {
      writeAuthFailure(res, error);
      return false;
    }

    const authManager = new AuthManager();
    const credential = credentialSource.getCredential(identity);
    if (credential) {
      authManager.connect(credential.apiUrl, credential.apiToken, credential.authType);
    }

    const requestContext: RequestContext = { identity, authManager };
    attachRequestContext(req, requestContext);

    // Populate the SDK's `req.auth` for completeness / any downstream scope
    // check. The token field is deliberately a non-secret placeholder — the
    // real bearer token is never re-surfaced past validation.
    const authInfo: AuthInfo = { token: 'oidc', clientId: identity.sub, scopes: [] };
    req.auth = authInfo;

    return true;
  };
}

/** Maps the loaded `OidcConfig` to the validator's config shape (1:1 field copy). */
function toValidatorConfig(oidc: OidcConfig): OidcJwtValidatorConfig {
  const config: OidcJwtValidatorConfig = {
    issuer: oidc.issuer,
    audience: oidc.audience,
    jwksUri: oidc.jwksUri,
  };
  if (oidc.allowedAlgs) {
    config.allowedAlgs = oidc.allowedAlgs;
  }
  if (oidc.clockSkewSec !== undefined) {
    config.clockSkewSec = oidc.clockSkewSec;
  }
  if (oidc.requiredScope) {
    config.requiredScope = oidc.requiredScope;
  }
  return config;
}

/**
 * Production orchestration: build the JWT validator from config (loading
 * `jose`), construct the H2 vault-backed credential source, and register the
 * resulting middleware on the transport auth seam. Must be called before
 * `startHttpTransport` — otherwise the transport refuses to start
 * (deny-mixed-mode, §2).
 *
 * Fails loud (throws a `ConfigurationError`, never a silent fallback) when
 * `oidc-http` mode has no usable vault: no `vault.path`
 * (`VIKUNJA_MCP_VAULT_PATH`) or no master key (`VIKUNJA_MCP_VAULT_KEY[_FILE]`,
 * `resolveVaultMasterKey`) configured. This is the vault half of the "any
 * missing → hard startup error" selection rule (§2) — a hosted deployment
 * must never come up serving OIDC-authenticated traffic with nowhere to
 * store (or find) a Vikunja credential.
 *
 * `loadDeps` is injectable so this orchestration is unit-testable without a
 * real ESM `import('jose')` (which Jest's CommonJS runner cannot execute);
 * production passes the default {@link loadJose}.
 */
export async function setupOidcHttpAuth(
  oidc: OidcConfig,
  vault: VaultConfig,
  loadDeps: () => Promise<JoseDeps> = loadJose
): Promise<void> {
  const deps = await loadDeps();
  const validator = createOidcJwtValidator(toValidatorConfig(oidc), deps);

  const vaultPath = resolveVaultPath(vault.path);
  if (!vaultPath) {
    throw new ConfigurationError(
      'vault.path',
      'oidc-http mode requires a credential vault file path. Set ' +
        'VIKUNJA_MCP_VAULT_PATH (or the vault.path config key) to a writable ' +
        'file location for the encrypted credential vault.',
    );
  }
  const masterKey = resolveVaultMasterKey();
  const vaultStore = new VaultFileStore(vaultPath, masterKey);
  setActiveVaultStore(vaultStore);
  const credentialSource = new VaultCredentialSource(vaultStore);

  setOidcAuthMiddleware(createOidcHttpAuthMiddleware({ validator, credentialSource }));
  logger.info(
    'OIDC HTTP authentication middleware registered (resource-server mode; ' +
      'vault-backed credential provisioning via vikunja_auth provision)'
  );
}
