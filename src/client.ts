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
 */
export async function getAuthManagerFromContext(): Promise<AuthManager> {
  const requestContext = getRequestContext();
  if (requestContext) {
    return requestContext.authManager;
  }
  const context = await ClientContext.getInstanceAsync();
  return context.getAuthManager();
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
