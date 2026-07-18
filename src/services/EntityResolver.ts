/**
 * Entity Resolver Service
 *
 * Handles label and user resolution for batch import operations.
 * This service encapsulates the complex logic for fetching entities from the Vikunja API,
 * handling authentication errors, and creating name-to-ID mappings.
 */

import { logger } from '../utils/logger';
import { isAuthenticationError } from '../utils/auth-error-handler';
import type { AuthManager } from '../auth/AuthManager';
import { MCPError } from '../types';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import type { components } from '../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json).
type VikunjaUser = components['schemas']['user.User'];
type VikunjaLabel = components['schemas']['models.Label'];

/**
 * Result of entity resolution operations
 */
export interface EntityResolutionResult {
  /** Map of lowercase label names to label IDs */
  labelMap: Map<string, number>;
  /** Map of lowercase usernames to user IDs */
  userMap: Map<string, number>;
  /** Whether user fetch failed due to known authentication issues */
  userFetchFailedDueToAuth: boolean;
  /** Raw labels array for reference */
  projectLabels: VikunjaLabel[];
  /** Raw users array for reference */
  projectUsers: VikunjaUser[];
}

/**
 * Entity Resolver service for mapping label and user names to IDs
 */
export class EntityResolver {
  /**
   * Fetches labels and users from the Vikunja API and creates resolution maps
   *
   * This method handles the complex logic of:
   * - Fetching labels with robust error handling for malformed responses
   * - Fetching users with special handling for known Vikunja API authentication issues
   * - Creating case-insensitive name-to-ID mappings
   * - Providing comprehensive logging for debugging
   *
   * @param authManager - Active auth manager holding the session credentials,
   *   used for the direct-REST `GET /labels` and `GET /users` calls
   * @param assigneeUsernames - Usernames referenced by the batch being
   *   imported (e.g. every task's `assignees` list, deduplicated by the
   *   caller). Per the OpenAPI spec `GET /users` is a *search* endpoint
   *   (the `s` query param is its only documented filter) — there is no
   *   "list every user" call to make. Passing the actual usernames that
   *   need resolving lets this method search for each one individually
   *   instead of making a single parameter-less call the spec never
   *   promised would return anything useful. Defaults to `[]` (no
   *   assignees referenced → no `/users` calls at all).
   * @returns Promise resolving to entity resolution results
   */
  async resolveEntities(
    authManager: AuthManager,
    assigneeUsernames: string[] = [],
  ): Promise<EntityResolutionResult> {
    const result: EntityResolutionResult = {
      labelMap: new Map(),
      userMap: new Map(),
      userFetchFailedDueToAuth: false,
      projectLabels: [],
      projectUsers: [],
    };

    await this.fetchLabels(authManager, result);

    await this.fetchUsers(authManager, assigneeUsernames, result);

    this.createResolutionMaps(result);

    // Log the final result for debugging
    logger.debug('Label and user maps created', {
      labelMapSize: result.labelMap.size,
      labelMapEntries: Array.from(result.labelMap.entries()),
      userMapSize: result.userMap.size,
    });

    return result;
  }

  /**
   * Fetch labels from the API with robust error handling
   *
   * Handles multiple edge cases:
   * - null/undefined responses
   * - Non-array responses
   * - Network errors
   * - Auth errors (less common for labels than users)
   *
   * @param authManager - Active auth manager holding the session credentials
   * @param result - The result object to update with fetched labels
   */
  private async fetchLabels(
    authManager: AuthManager,
    result: EntityResolutionResult
  ): Promise<void> {
    try {
      // GET /labels per the OpenAPI spec (models.Label[]).
      const labelsResponse = await vikunjaRestRequest<VikunjaLabel[]>(
        authManager,
        'GET',
        '/labels',
      );

      // Handle potential null/undefined response
      if (!labelsResponse) {
        logger.warn('Labels response is null/undefined');
        result.projectLabels = [];
        return;
      }

      // Handle non-array responses
      if (!Array.isArray(labelsResponse)) {
        logger.warn('Labels response is not an array', {
          responseType: typeof labelsResponse,
          response: labelsResponse,
        });
        result.projectLabels = [];
        return;
      }

      // Valid response
      result.projectLabels = labelsResponse;
      logger.debug('Labels fetched', {
        count: result.projectLabels.length,
        labels: result.projectLabels.map((l): { id: number; title: string } => ({ id: l.id ?? 0, title: l.title ?? '' })),
      });
    } catch (error) {
      logger.error('Failed to fetch labels', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      result.projectLabels = [];
      // Continue without labels mapping
    }
  }

  /**
   * Fetch users from the API with authentication error handling
   *
   * KNOWN VIKUNJA API ISSUE: Users endpoint often fails with API tokens.
   * This is not a bug in our code - it's a documented Vikunja API limitation.
   *
   * FIXED (was: docs/API-COVERAGE.md Issues table, MEDIUM): per the vendored
   * OpenAPI spec, `GET /users` is a *search* endpoint ("Search for a user by
   * its username, name or full email") that takes an `s` query parameter —
   * it is not a "list all users I can see" endpoint. This method used to
   * call it with no `s` at all (matching the pre-migration legacy client
   * call, which passed the same empty `{}` params), which on a real server
   * returns an empty array rather than the full set of assignable project
   * users, silently breaking every assignee-by-username resolution. It now
   * issues one `GET /users?s=<username>` search per unique username actually
   * referenced by the batch (passed in as `assigneeUsernames`), matching the
   * endpoint's documented contract, and merges the (deduplicated-by-id)
   * results. When `assigneeUsernames` is empty (no task in the batch
   * references an assignee) no `/users` call is made at all.
   *
   * @param authManager - Active auth manager for the direct-REST calls
   * @param assigneeUsernames - Usernames to search for, one `s=` query per
   *   unique entry (case-insensitive dedup is the caller's responsibility;
   *   duplicates here just cost an extra, harmless round trip)
   * @param result - The result object to update with fetched users
   */
  private async fetchUsers(
    authManager: AuthManager,
    assigneeUsernames: string[],
    result: EntityResolutionResult
  ): Promise<void> {
    if (assigneeUsernames.length === 0) {
      result.projectUsers = [];
      logger.debug('No assignee usernames referenced by this batch; skipping /users search entirely');
      return;
    }

    const usersById = new Map<number, VikunjaUser>();
    try {
      for (const username of assigneeUsernames) {
        const usersResponse = await vikunjaRestRequest<VikunjaUser[]>(
          authManager,
          'GET',
          `/users?s=${encodeURIComponent(username)}`,
        );
        for (const user of usersResponse || []) {
          if (user && user.id !== null && user.id !== undefined) {
            usersById.set(user.id, user);
          }
        }
      }
      result.projectUsers = Array.from(usersById.values());
      logger.debug('Users fetched', {
        searchCount: assigneeUsernames.length,
        count: result.projectUsers.length,
      });
    } catch (error) {
      // This is a known limitation with Vikunja API authentication. Checked
      // directly via `details.statusCode` (set by `vikunjaRestRequest` on
      // every non-2xx response) alongside the shared message-pattern
      // classifier: `isAuthenticationError`'s structured checks look for
      // `.status`/`.response.status`, properties the legacy client's HTTP errors
      // carried but a plain `MCPError` from the REST helper does not — so a
      // bare 401/403 with a response body that doesn't happen to match one
      // of the message-pattern fallbacks would otherwise stop being
      // classified as an auth failure after this transport migration.
      const statusCode = error instanceof MCPError ? error.details?.statusCode : undefined;
      if (statusCode === 401 || statusCode === 403 || isAuthenticationError(error)) {
        logger.warn(
          'Cannot fetch users due to known Vikunja API authentication issue. Assignees will be skipped.',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        result.userFetchFailedDueToAuth = true;
        // Continue without user mapping - assignees will be ignored
      } else {
        // Some other error - log but continue
        logger.warn('Failed to fetch users', { error });
      }
      // Preserve whatever users were successfully resolved before the
      // failing search (partial results are still useful), matching the
      // "continue, best-effort" behavior of the rest of this method.
      result.projectUsers = Array.from(usersById.values());
    }
  }

  /**
   * Create case-insensitive resolution maps from fetched entities
   *
   * This method is more defensive than the original batch-import.ts implementation.
   * The original code would crash on undefined/null titles, but this implementation
   * handles edge cases gracefully by converting them to unique string representations.
   *
   * @param result - The result object to update with resolution maps
   */
  private createResolutionMaps(result: EntityResolutionResult): void {
    // Create case-insensitive label name to ID map
    result.labelMap = new Map(
      (result.projectLabels || [])
        .filter((label): label is VikunjaLabel & { id: number } => label !== null && label.id !== null && label.id !== undefined)
        .map((label) => {
          let key: string;
          if (!('title' in label)) {
            key = '[missing]';
          } else if (label.title === null) {
            key = '[null]';
          } else if (label.title === undefined) {
            key = '[undefined]';
          } else {
            key = String(label.title).toLowerCase();
          }
          return [key, label.id];
        })
    );

    // Create case-insensitive username to ID map
    result.userMap = new Map(
      (result.projectUsers || [])
        .filter((user): user is VikunjaUser & { id: number } => user !== null && user.id !== null && user.id !== undefined)
        .map((user) => {
          let key: string;
          if (!('username' in user)) {
            key = '[missing]';
          } else if (user.username === null) {
            key = '[null]';
          } else if (user.username === undefined) {
            key = '[undefined]';
          } else {
            key = String(user.username).toLowerCase();
          }
          return [key, user.id];
        })
    );
  }
}