/**
 * Vikunja session factory
 *
 * Holds the active {@link AuthManager} for the current MCP session and hands
 * it to the direct-REST transport (`vikunjaRestRequest`). It no longer creates
 * a legacy typed API client — that upstream library was retired from this
 * project (docs/ROADMAP.md §3 decision 2); every API call now goes through
 * `vikunjaRestRequest` against the vendored OpenAPI spec. The class name and
 * the `clientFactory` plumbing are preserved so tool registration signatures
 * (`register*Tool(server, authManager, clientFactory?)`) stay unchanged.
 */

import type { AuthManager } from '../auth/AuthManager';

/**
 * Factory that owns the session's {@link AuthManager} and exposes it to
 * REST-migrated call sites via dependency injection.
 */
export class VikunjaClientFactory {
  constructor(private readonly authManager: AuthManager) {}

  /**
   * Expose the session-holding AuthManager backing this factory.
   *
   * Direct-REST call sites (`vikunjaRestRequest`) need an `AuthManager` to
   * recover the session credentials. Tools that only receive a
   * `VikunjaClientFactory` (not the `AuthManager` directly) reach it through
   * this getter, and `getAuthManagerFromContext()` in `src/client.ts` reads
   * it off the active factory the same way.
   */
  getAuthManager(): AuthManager {
    return this.authManager;
  }

  /**
   * Check if the factory has a valid session
   */
  hasValidSession(): boolean {
    try {
      this.authManager.getSession();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup hook retained for call-site compatibility. There is no cached
   * client instance to release now that this factory only holds the
   * AuthManager, so this is a no-op.
   */
  cleanup(): void {
    // No cached client to release.
  }
}
