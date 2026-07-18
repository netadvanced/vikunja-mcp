/**
 * Vikunja Client Factory
 * Provides dependency injection for Vikunja client instances
 */

import type { VikunjaClient } from 'node-vikunja';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientConstructor } from '../types/node-vikunja-extended';

/**
 * Factory for creating and managing Vikunja client instances
 * Uses dependency injection instead of global state
 */
export class VikunjaClientFactory {
  private clientInstance: VikunjaClient | null = null;
  private currentApiUrl: string | null = null;
  private currentApiToken: string | null = null;

  constructor(
    private readonly authManager: AuthManager,
    private readonly VikunjaClientClass: VikunjaClientConstructor
  ) {}

  /**
   * Get an authenticated Vikunja client instance
   */
  getClient(): VikunjaClient {
    const session = this.authManager.getSession();

    // Check if we need to create a new client
    if (!this.clientInstance || 
        this.currentApiUrl !== session.apiUrl || 
        this.currentApiToken !== session.apiToken) {
      
      // Clean up old client if it exists
      if (this.clientInstance) {
        this.clientInstance = null;
      }
      
      this.clientInstance = new this.VikunjaClientClass(session.apiUrl, session.apiToken);
      this.currentApiUrl = session.apiUrl;
      this.currentApiToken = session.apiToken;
    }

    if (!this.clientInstance) {
      throw new Error('Failed to create Vikunja client instance');
    }
    
    return this.clientInstance;
  }

  /**
   * Expose the session-holding AuthManager backing this factory.
   *
   * Direct-REST call sites (`vikunjaRestRequest`) need an `AuthManager`, not
   * a `VikunjaClient` — but several Wave D sub-resource migrations (e.g.
   * `setTaskLabels` in `src/utils/label-bulk.ts`) are called from task CRUD
   * services that only ever pass a `VikunjaClient`. Rather than threading a
   * new `AuthManager` parameter through those CRUD call sites (out of scope
   * for a sub-resource-only migration), REST-migrated utilities that are
   * reached that way can recover the same session via
   * `getAuthManagerFromContext()` in `src/client.ts`, which reads it off the
   * active factory through this getter.
   */
  getAuthManager(): AuthManager {
    return this.authManager;
  }

  /**
   * Cleanup function to reset client instance
   */
  cleanup(): void {
    this.clientInstance = null;
    this.currentApiUrl = null;
    this.currentApiToken = null;
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
}