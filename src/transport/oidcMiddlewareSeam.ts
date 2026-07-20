/**
 * Seam for the OIDC JWT-validation middleware (item H1b — JWT validation
 * middleware, docs/OIDC-RESOURCE-SERVER.md §3b, a parallel wave-H1 work
 * item).
 *
 * This item (H1a) builds the Streamable HTTP transport plumbing only; it
 * does not validate bearer tokens. Per the spec's deny-mixed-mode rule
 * (§2 "Selection rule"), `transport=http` must never serve unauthenticated
 * HTTP — so until H1b lands and registers a real middleware here via
 * `setOidcAuthMiddleware()`, `getOidcAuthMiddleware()` returns `undefined`
 * and `src/transport/httpTransport.ts` refuses to start the HTTP listener.
 *
 * TODO(H1b): replace this stub seam with the real JWT-validation middleware
 * described in docs/OIDC-RESOURCE-SERVER.md §3b — `jose`'s
 * `createRemoteJWKSet` + `jwtVerify`, validating `iss`/`aud`/`alg`
 * allowlist/`exp`/`nbf`/clock-skew/`sub`, attaching `{ sub, issuer, claims }`
 * to the request (via `req.auth`, matching the SDK's
 * `IncomingMessage & { auth?: AuthInfo }` contract) on success, or writing a
 * generic `401` with `WWW-Authenticate: Bearer error="invalid_token"` (or
 * `403` for a valid token missing `requiredScope`) on failure. Register the
 * real implementation by calling `setOidcAuthMiddleware()` during server
 * startup, before `startHttpTransport()` is invoked.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/** Node request shape the SDK's `StreamableHTTPServerTransport.handleRequest` expects. */
export type HttpRequestWithAuth = IncomingMessage & { auth?: AuthInfo };

/**
 * An OIDC authentication middleware validates the incoming request's bearer
 * token and either:
 *  - attaches `{ issuer, sub, claims }`-derived `AuthInfo` to `req.auth` and
 *    returns `true` (the caller should proceed to `transport.handleRequest`), or
 *  - writes the appropriate `401`/`403` response itself and returns `false`
 *    (the caller MUST NOT proceed — the response is already complete).
 */
export type OidcAuthMiddleware = (
  req: HttpRequestWithAuth,
  res: ServerResponse
) => Promise<boolean>;

let registeredMiddleware: OidcAuthMiddleware | undefined;

/**
 * Register the OIDC authentication middleware. Called once during server
 * startup (by H1b's wiring) before HTTP transport mode is started. Passing
 * `undefined` clears the registration (used by tests).
 */
export function setOidcAuthMiddleware(middleware: OidcAuthMiddleware | undefined): void {
  registeredMiddleware = middleware;
}

/**
 * Returns the registered OIDC authentication middleware, or `undefined` if
 * none has been registered yet (the H1a/pre-H1b state). Callers in `http`
 * transport mode MUST refuse to start when this returns `undefined` —
 * never serve unauthenticated HTTP.
 */
export function getOidcAuthMiddleware(): OidcAuthMiddleware | undefined {
  return registeredMiddleware;
}
