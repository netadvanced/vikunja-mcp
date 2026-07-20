/**
 * Credential source: identity -> Vikunja credential.
 *
 * Spec: docs/OIDC-RESOURCE-SERVER.md §3(c)/§3(d). A Keycloak/OIDC access
 * token authenticates a *person*, it is not itself a Vikunja credential —
 * the server needs a lookup from the validated identity to a Vikunja `tk_`
 * token. §3(c) specifies that lookup as an encrypted-JSON-file vault, but
 * that is explicitly H2 scope (wave plan, H2-1/H2-3). H1's job is only to
 * shape the seam so H2 plugs in without touching a single call site:
 *
 *  - `VikunjaCredentialSource` — the interface every call site programs
 *    against. `getCredential` returns `null` (never throws) when an
 *    identity has no linked credential; callers turn that into the
 *    structured `AUTH_REQUIRED` "provision" error (`createOidcAuthRequiredError`
 *    below), never a 500, and never anything that reveals whether some
 *    *other* identity is provisioned.
 *  - `StdioCredentialSource` — today's behaviour: one static credential
 *    (from env/config, `src/index.ts`'s existing bootstrap), identity-
 *    independent, because `stdio` mode is single-tenant. This is not a
 *    stub — it's the permanent stdio-mode implementation.
 *  - `OidcStubCredentialSource` — the H1 stand-in for the real vault.
 *    Always returns `null`, so every `oidc-http` caller gets the
 *    provisioning prompt until H2 lands `src/storage/vaultFileStore.ts` and
 *    a vault-backed implementation of this same interface (H2-3).
 */

import type { Identity } from '../context/requestContext';
import { MCPError, ErrorCode } from '../types/errors';
import { maskCredential } from '../utils/security';

/** A Vikunja credential resolved for one identity. */
export interface VikunjaCredential {
  readonly apiUrl: string;
  readonly apiToken: string;
  readonly authType?: 'api-token' | 'jwt';
}

/**
 * Resolves the Vikunja credential for a validated identity. Implementations
 * MUST derive the credential from `identity` alone (or, for `stdio`,
 * ignore it entirely in favour of the one process-wide credential) — never
 * from anything caller-supplied outside the validated request context. That
 * is what closes the "claim to be someone else" spoofing vector (§4,
 * isolation-matrix row "Vault lookup can't be spoofed").
 */
export interface VikunjaCredentialSource {
  getCredential(identity: Identity): VikunjaCredential | null;
}

/**
 * `stdio` mode: the one static credential configured for the whole
 * process (env `VIKUNJA_URL`/`VIKUNJA_API_TOKEN` today), identical for
 * every call regardless of `identity`.
 */
export class StdioCredentialSource implements VikunjaCredentialSource {
  constructor(private readonly credential: VikunjaCredential | null) {}

  // `identity` is intentionally unused — stdio is single-tenant, one
  // credential for the one process, exactly as today. The parameter stays
  // so this class satisfies the same interface as every oidc-mode source,
  // and so no stdio call site is ever tempted to special-case identity.
  getCredential(_identity: Identity): VikunjaCredential | null {
    return this.credential;
  }
}

/**
 * `oidc-http` mode, H1 scope: no vault yet (H2-1/H2-3). Every identity is
 * unprovisioned until a real, vault-backed `VikunjaCredentialSource`
 * replaces this stub.
 */
export class OidcStubCredentialSource implements VikunjaCredentialSource {
  getCredential(_identity: Identity): VikunjaCredential | null {
    return null;
  }
}

/**
 * The structured `AUTH_REQUIRED` error for a validly-authenticated identity
 * that has no linked Vikunja credential — exact shape from §3(c)'s
 * "Missing-credential behaviour": never a 500, and the message masks the
 * `sub` (never echoes it in full) and never leaks whether any other
 * identity is provisioned.
 */
export function createOidcAuthRequiredError(identity: Identity): MCPError {
  const maskedSub = maskCredential(identity.sub) || '[REDACTED]';
  return new MCPError(
    ErrorCode.AUTH_REQUIRED,
    `You're authenticated as ${maskedSub} but haven't linked a Vikunja API token yet. ` +
      `Run vikunja_auth provision with a token you create in Vikunja → Settings → API Tokens.`,
  );
}
