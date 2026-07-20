/**
 * Per-request identity context.
 *
 * Spec: docs/OIDC-RESOURCE-SERVER.md §3d (D6) — `oidc-http` mode is
 * multi-user; every piece of state that today assumes "one process = one
 * user" must be re-keyed by the validated caller's identity, `(issuer,
 * sub)`. The mechanism that makes this tractable without threading an
 * `authManager`/identity parameter through every tool call stack is a single
 * `AsyncLocalStorage` scope opened once per request (by the JWT middleware,
 * around `transport.handleRequest`) and read back through a handful of
 * accessors — this module.
 *
 * `stdio` mode NEVER opens an ALS scope. Every accessor here degrades to
 * `undefined`/a legacy fallback when called outside one, which is exactly
 * how `stdio` behaves: the ALS machinery isn't merely "unused", it is never
 * constructed differently at all — `getStore()` on a store nobody ever
 * `.run()`s into simply returns `undefined`. This is the invariant the spec
 * calls out as needing a regression test (§3d): stdio's behaviour must be
 * byte-for-byte unchanged, not "unchanged so far as we've noticed".
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthManager } from '../auth/AuthManager';

/**
 * The validated caller identity. Keyed as a pair (not `sub` alone) per D11:
 * single-issuer ships first, but pair-keying means a second issuer/realm
 * that happens to mint a colliding `sub` can never collide with another's
 * state — adding a second issuer later is an allowlist change, not a
 * data-model migration.
 */
export interface Identity {
  readonly issuer: string;
  readonly sub: string;
}

/** Per-request context bound in ALS for the lifetime of one JSON-RPC call. */
export interface RequestContext {
  readonly identity: Identity;
  readonly authManager: AuthManager;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Stable string key for an identity: `"<issuer>|<sub>"`. Matches the vault's
 * on-disk record key from §3c (`"<issuer>|<sub>"`) exactly, and is reused
 * everywhere global state is re-keyed by identity (rate-limiter buckets,
 * filter/template storage session ids) so every re-keyed store shares one
 * canonical tenancy key.
 */
export function identityKey(identity: Identity): string {
  return `${identity.issuer}|${identity.sub}`;
}

/**
 * Run `fn` with `context` bound in ALS for the duration of the call
 * (including through any awaited async work `fn` kicks off). This is the
 * only way a `RequestContext` ever becomes visible to `getRequestContext()`
 * — `stdio` mode never calls this, so it never opens an ALS scope at all.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

/**
 * The active request context, or `undefined` when called outside any ALS
 * scope — always the case in `stdio` mode.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/** Convenience: the active identity, or `undefined` outside an ALS scope. */
export function getCurrentIdentity(): Identity | undefined {
  return requestContextStorage.getStore()?.identity;
}

/**
 * Effective session id for keying `SimpleFilterStorage`-backed state (the
 * tasks tool's own session-scoped storage, and `vikunja_templates` —
 * isolation-table rows #3/#4 in docs/OIDC-RESOURCE-SERVER.md §3d).
 *
 * Inside an ALS scope (`oidc-http` mode) this is the identity key, so two
 * concurrent identities can never share a bucket. Outside one (`stdio`
 * mode, always) it falls back to the pre-existing
 * `${apiUrl}:${apiToken.substring(0,8)}` (or `'anonymous'`) derivation,
 * unchanged — single-tenant behaviour is not merely preserved, the code
 * path that computes it is untouched.
 */
export function getEffectiveSessionId(authManager: AuthManager): string {
  const identity = getCurrentIdentity();
  if (identity) {
    return identityKey(identity);
  }
  const session = authManager.getSession();
  return session.apiToken ? `${session.apiUrl}:${session.apiToken.substring(0, 8)}` : 'anonymous';
}
