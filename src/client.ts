/**
 * Vikunja session context
 *
 * Holds the active session (via {@link VikunjaClientFactory}, which now wraps
 * only an {@link AuthManager}) and exposes it to the direct-REST transport.
 * The legacy typed-client surface that used to live here was removed when the
 * upstream client library was retired (docs/ROADMAP.md §3 decision 2) — all
 * API calls now go through `vikunjaRestRequest` (`src/utils/vikunja-rest.ts`).
 */

import type { AuthManager } from './auth/AuthManager';
import { VikunjaClientFactory } from './client/VikunjaClientFactory';
import { Mutex } from 'async-mutex';
import { createAuthRequiredError } from './utils/error-handler';
import { getRequestContext } from './context/requestContext';
import { createOidcAuthRequiredError } from './auth/CredentialSource';

export { VikunjaClientFactory } from './client/VikunjaClientFactory';

/**
 * Session context for dependency injection with thread safety.
 *
 * NOTE: Only async getInstanceAsync() method is available to prevent race conditions.
 */
class ClientContext {
  private static instance: ClientContext | null = null;
  private static instanceMutex = new Mutex();
  private clientFactory: VikunjaClientFactory | null = null;
  private factoryMutex = new Mutex();

  private constructor() {}

  /**
   * Thread-safe async getInstance for new code
   */
  static async getInstanceAsync(): Promise<ClientContext> {
    const release = await ClientContext.instanceMutex.acquire();
    try {
      if (!ClientContext.instance) {
        ClientContext.instance = new ClientContext();
      }
      return ClientContext.instance;
    } finally {
      release();
    }
  }

  /**
   * Set the client factory for dependency injection (thread-safe)
   */
  async setClientFactory(factory: VikunjaClientFactory): Promise<void> {
    const release = await this.factoryMutex.acquire();
    try {
      this.clientFactory = factory;
    } finally {
      release();
    }
  }

  /**
   * Clear the client factory (for testing, thread-safe)
   */
  async clearClientFactory(): Promise<void> {
    const release = await this.factoryMutex.acquire();
    try {
      this.clientFactory = null;
    } finally {
      release();
    }
  }

  /**
   * Get the AuthManager backing the active session factory (thread-safe).
   *
   * REST-migrated call sites recover the session credentials through this
   * rather than threading an `AuthManager` down every call stack.
   */
  async getAuthManager(): Promise<AuthManager> {
    const release = await this.factoryMutex.acquire();
    try {
      if (this.clientFactory) {
        return this.clientFactory.getAuthManager();
      }
      throw createAuthRequiredError('get Vikunja auth manager');
    } finally {
      release();
    }
  }

  /**
   * Check if factory is available (thread-safe)
   */
  async hasFactory(): Promise<boolean> {
    const release = await this.factoryMutex.acquire();
    try {
      return this.clientFactory !== null;
    } finally {
      release();
    }
  }
}

/**
 * Convenience function to get the active AuthManager from context
 * (thread-safe). See `ClientContext.getAuthManager()`.
 *
 * Re-pointed per docs/OIDC-RESOURCE-SERVER.md §3d (D6): when an ALS
 * `RequestContext` is bound (`oidc-http` mode, one scope per request — see
 * `src/context/requestContext.ts`), its per-identity `AuthManager` is
 * returned directly, so every one of the dozens of REST-migrated call
 * sites that already recover credentials through this accessor gets
 * per-user isolation for free. `stdio` mode never opens an ALS scope, so
 * `getRequestContext()` is always `undefined` there and this falls through
 * to the original global-singleton path, unchanged.
 *
 * Integration wiring (H1 §3c "Missing-credential behaviour"): when an ALS
 * context is bound but its per-identity `AuthManager` carries no session,
 * the caller is a validly-authenticated OIDC identity that has no linked
 * Vikunja credential (the H1 `OidcStubCredentialSource` returns `null` for
 * everyone until H2's vault lands). Every REST-migrated tool funnels through
 * this accessor, so converting that state into the structured
 * `AUTH_REQUIRED` "provision" error here — once — gives the whole tool
 * surface the correct, `sub`-masked provisioning prompt instead of a generic
 * "not connected" message, and never leaks whether any other identity is
 * provisioned. `stdio` mode is unaffected (it never binds an ALS context).
 */
export async function getAuthManagerFromContext(): Promise<AuthManager> {
  const requestContext = getRequestContext();
  if (requestContext) {
    if (!requestContext.authManager.isAuthenticated()) {
      throw createOidcAuthRequiredError(requestContext.identity);
    }
    return requestContext.authManager;
  }
  const context = await ClientContext.getInstanceAsync();
  return context.getAuthManager();
}

/**
 * Whether an ALS `RequestContext` is currently bound — i.e. this call is
 * running inside `oidc-http` mode's per-request scope
 * (`src/context/requestContext.ts`). `stdio` mode never opens one, so this
 * is always `false` there.
 *
 * Closure-gate precedence fix (docs/OIDC-RESOURCE-SERVER.md §3c, H1
 * integration owner-attention #2): dozens of tools gate on the
 * process-global closure `AuthManager`'s `isAuthenticated()` *before* ever
 * calling {@link getAuthManagerFromContext}. In `oidc-http` mode that
 * closure manager is never authenticated (there is no static per-process
 * credential — every identity's credential lives behind the vault, keyed by
 * the per-request ALS context), so that up-front check always fired first
 * and threw the tool's own generic "please connect" message — masking the
 * correct, `sub`-scoped `createOidcAuthRequiredError` "provision" prompt
 * that {@link getAuthManagerFromContext} would otherwise produce.
 *
 * The fix mirrors {@link getAuthManagerFromContext}'s own ALS-first order:
 * every up-front gate consults `hasRequestContext()` first and, when bound,
 * defers entirely to {@link getAuthManagerFromContext} (which throws the
 * correctly-scoped error itself) instead of evaluating the closure
 * manager's `isAuthenticated()` at all. `stdio` mode is unaffected — this
 * always returns `false` there, so every gate's `else` branch (the
 * pre-existing `authManager.isAuthenticated()` check) runs byte-for-byte
 * unchanged.
 */
export function hasRequestContext(): boolean {
  return getRequestContext() !== undefined;
}

/**
 * Set the global client factory for all tools (thread-safe)
 */
export async function setGlobalClientFactory(factory: VikunjaClientFactory): Promise<void> {
  const context = await ClientContext.getInstanceAsync();
  await context.setClientFactory(factory);
}

/**
 * Clear the global client factory (for testing, thread-safe)
 */
export async function clearGlobalClientFactory(): Promise<void> {
  const context = await ClientContext.getInstanceAsync();
  await context.clearClientFactory();
}

export { ClientContext };

/**
 * Creates a new VikunjaClientFactory bound to the given session.
 *
 * Returns a Promise to keep the call signature stable for existing awaiting
 * callers, even though construction is now synchronous (there is no longer a
 * dynamic client-library import to await).
 */
export function createVikunjaClientFactory(authManager: AuthManager): Promise<VikunjaClientFactory> {
  return Promise.resolve(new VikunjaClientFactory(authManager));
}
