import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EntityResolver } from '../../src/services/EntityResolver';
import { AuthManager } from '../../src/auth/AuthManager';
import { logger } from '../../src/utils/logger';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import type { components } from '../../src/types/generated/vikunja-openapi';

// Mock logger to avoid noise in tests
jest.mock('../../src/utils/logger');

// Spec-sourced entity shapes (docs/vikunja-openapi.json).
type Label = components['schemas']['models.Label'];
type User = components['schemas']['user.User'];

// EntityResolver is fully migrated off node-vikunja: `fetchLabels`
// (`GET /labels`) and `fetchUsers` (`GET /users`) both go through the
// direct-REST helper, which talks to `global.fetch`. Route each endpoint to
// its own jest.fn so the two responses stay independently controllable:
//   - `getLabelsMock` resolves the raw labels value (array / null / non-array)
//     or rejects; its value is JSON-serialized into the fetch Response body.
//   - `getUsersMock` resolves a ready-made `Response` (so a test can craft a
//     401, an empty body, etc.) or rejects to model a network-level failure.
const getLabelsMock = jest.fn<() => Promise<unknown>>();
const getUsersMock = jest.fn<() => Promise<Response>>();
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object for the REST helper. */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text?: string;
}): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

/** Configure the labels response (the raw value the API returns). */
function respondLabels(value: unknown): void {
  getLabelsMock.mockResolvedValue(value);
}
/** Configure `GET /labels` to reject (network-level failure). */
function rejectLabels(error: unknown): void {
  getLabelsMock.mockRejectedValue(error);
}
/** Configure a successful `GET /users` JSON response. */
function usersJson(body: unknown): void {
  getUsersMock.mockResolvedValue(mockResponse({ text: JSON.stringify(body) }));
}
/** Configure a raw-body `GET /users` response (e.g. empty body). */
function usersRaw(text: string): void {
  getUsersMock.mockResolvedValue(mockResponse({ text }));
}
/** Configure a non-2xx `GET /users` response (e.g. a 401). */
function usersStatus(status: number, text: string): void {
  getUsersMock.mockResolvedValue(mockResponse({ ok: false, status, text }));
}
/** Configure `GET /users` to reject (network-level failure). */
function rejectUsers(error: unknown): void {
  getUsersMock.mockRejectedValue(error);
}

describe('EntityResolver', () => {
  let resolver: EntityResolver;
  let authManager: AuthManager;

  // Mock data
  const mockLabels: Label[] = [
    { id: 1, title: 'Bug', description: 'Bug reports', hex_color: '#ff0000' },
    { id: 2, title: 'Feature', description: 'New features', hex_color: '#00ff00' },
    { id: 3, title: 'Documentation', description: 'Documentation tasks', hex_color: '#0000ff' },
  ];

  const mockUsers: User[] = [
    { id: 101, username: 'alice', email: 'alice@example.com', name: 'Alice' },
    { id: 102, username: 'bob', email: 'bob@example.com', name: 'Bob' },
    { id: 103, username: 'charlie', email: 'charlie@example.com', name: 'Charlie' },
  ];

  // Usernames a hypothetical batch import references as assignees — passed
  // to `resolveEntities` so `fetchUsers` has something to search `s=` for
  // (see the MEDIUM issue this migration fixed: `GET /users` is a *search*
  // endpoint, not a "list everyone" one).
  const mockUsernames = ['alice', 'bob', 'charlie'];

  beforeEach(() => {
    resolver = new EntityResolver();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    // Clear all mocks
    jest.clearAllMocks();
    getLabelsMock.mockReset();
    getUsersMock.mockReset();
    mockFetch.mockReset();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats so one test's deliberately
    // failing scenario doesn't trip the breaker for a later test.
    circuitBreakerRegistry.clear();

    // Route the two GET endpoints EntityResolver now hits to their dedicated
    // controllable mocks.
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET') as string;
      if (method === 'GET' && /\/labels$/.test(url)) {
        const value = await getLabelsMock();
        return mockResponse({ text: value === undefined ? '' : JSON.stringify(value) });
      }
      if (method === 'GET' && /\/users(\?|$)/.test(url)) {
        return getUsersMock();
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
  });

  describe('resolveEntities', () => {
    it('should successfully resolve both labels and users', async () => {
      // Arrange
      respondLabels(mockLabels);
      usersJson(mockUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, mockUsernames);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(3);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual(mockLabels);
      // Each username search returns the full mock list in this test, so
      // the merged (deduped-by-id) result still has exactly the 3 users.
      expect(result.projectUsers).toHaveLength(3);
      expect(result.projectUsers).toEqual(expect.arrayContaining(mockUsers));

      // FIXED (was: docs/API-COVERAGE.md Issues table, MEDIUM): GET /users
      // is a *search* endpoint per the OpenAPI spec — this now issues one
      // `s=<username>` search per referenced username instead of a single
      // parameter-less "list everyone" call.
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/users?s=alice',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/users?s=bob',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/users?s=charlie',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(getUsersMock).toHaveBeenCalledTimes(3);
      // ...and GET /labels is untouched by this fix.
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/labels',
        expect.objectContaining({ method: 'GET' }),
      );

      // Verify case-insensitive mapping (map stores lowercase keys)
      expect(result.labelMap.get('bug')).toBe(1);
      expect(result.labelMap.get('feature')).toBe(2);
      expect(result.labelMap.get('documentation')).toBe(3);

      expect(result.userMap.get('alice')).toBe(101);
      expect(result.userMap.get('bob')).toBe(102);
      expect(result.userMap.get('charlie')).toBe(103);
    });

    it('should handle empty arrays correctly', async () => {
      // Arrange
      respondLabels([]);
      usersJson([]);

      // Act: a single referenced username that the server reports no match for.
      const result = await resolver.resolveEntities(authManager, ['nobody']);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(0);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual([]);
    });

    it('should skip the /users call entirely when no assignee usernames are referenced', async () => {
      // Arrange: this is the regression case for the MEDIUM issue — no
      // batch task references an assignee, so there is nothing to search
      // for and no reason to hit /users at all (previously this made a
      // single parameter-less, spec-non-compliant call every time).
      respondLabels(mockLabels);

      // Act
      const result = await resolver.resolveEntities(authManager, []);

      // Assert
      expect(result.userMap.size).toBe(0);
      expect(result.projectUsers).toEqual([]);
      expect(getUsersMock).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/users'),
        expect.anything(),
      );
      // Same behavior when the parameter is simply omitted (the default).
      const resultNoArg = await resolver.resolveEntities(authManager);
      expect(resultNoArg.projectUsers).toEqual([]);
      expect(getUsersMock).not.toHaveBeenCalled();
    });

    it('should handle null label response', async () => {
      // Arrange
      respondLabels(null);
      usersJson(mockUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, mockUsernames);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(expect.arrayContaining(mockUsers));
      expect(logger.warn).toHaveBeenCalledWith('Labels response is null/undefined');
    });

    it('should handle undefined label response', async () => {
      // Arrange: an empty response body deserializes to `null` in the REST
      // helper, matching the pre-migration undefined case.
      respondLabels(undefined);
      usersJson(mockUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, mockUsernames);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(expect.arrayContaining(mockUsers));
      expect(logger.warn).toHaveBeenCalledWith('Labels response is null/undefined');
    });

    it('should handle non-array label response', async () => {
      // Arrange
      respondLabels({ invalid: 'response' });
      usersJson(mockUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, mockUsernames);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(expect.arrayContaining(mockUsers));
      expect(logger.warn).toHaveBeenCalledWith('Labels response is not an array', expect.any(Object));
    });

    it('should handle authentication error for users', async () => {
      // Arrange: a real 401 response shape, classified via the explicit
      // `statusCode` check added for this migration (see EntityResolver's
      // fetchUsers — a plain MCPError from vikunjaRestRequest doesn't carry
      // the `.status`/`.response.status` properties isAuthenticationError's
      // structured checks look for).
      respondLabels(mockLabels);
      usersStatus(401, 'missing, malformed, expired or otherwise invalid token provided');

      // Act
      const result = await resolver.resolveEntities(authManager, ['alice']);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(0);
      expect(result.userFetchFailedDueToAuth).toBe(true);
      expect(result.projectLabels).toEqual(mockLabels);
      expect(result.projectUsers).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot fetch users due to known Vikunja API authentication issue. Assignees will be skipped.',
        expect.any(Object)
      );
    });

    it('should handle generic error for users', async () => {
      // Arrange
      respondLabels(mockLabels);
      // Not a message pattern isAuthenticationError/isRetryableError
      // recognizes, so this fails on the first attempt with no retries.
      rejectUsers(new Error('Service unavailable'));

      // Act
      const result = await resolver.resolveEntities(authManager, ['alice']);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(0);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual(mockLabels);
      expect(result.projectUsers).toEqual([]);
      // The direct-REST helper always wraps the original error into its own
      // MCPError before it reaches this catch, so the logged error is no
      // longer the exact original `Error` instance — just check its shape.
      expect(logger.warn).toHaveBeenCalledWith('Failed to fetch users', {
        error: expect.any(Error),
      });
    });

    it('should handle error for labels', async () => {
      // Arrange
      const labelError = new Error('Label service unavailable');
      rejectLabels(labelError);
      usersJson(mockUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, mockUsernames);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(expect.arrayContaining(mockUsers));
      // GET /labels now flows through vikunjaRestRequest, which wraps the
      // original message with its own request context — substring match.
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch labels',
        expect.objectContaining({
          error: expect.stringContaining('Label service unavailable'),
        })
      );
    });

    it('should handle both label and user errors simultaneously', async () => {
      // Arrange
      const labelError = new Error('Label service down');
      rejectLabels(labelError);
      usersStatus(401, 'Auth failed');

      // Act
      const result = await resolver.resolveEntities(authManager, ['alice']);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(0);
      expect(result.userFetchFailedDueToAuth).toBe(true);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch labels',
        expect.any(Object)
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot fetch users due to known Vikunja API authentication issue. Assignees will be skipped.',
        expect.any(Object)
      );
    });

    it('should preserve case-insensitive behavior for edge cases', async () => {
      // Arrange
      const edgeCaseLabels: Label[] = [
        { id: 1, title: '  Trimming  ', description: 'Spaces', hex_color: '#ff0000' },
        { id: 2, title: 'Special@Chars', description: 'Special characters', hex_color: '#00ff00' },
        { id: 3, title: '', description: 'Empty title', hex_color: '#0000ff' },
      ];

      const edgeCaseUsers: User[] = [
        { id: 101, username: '  spaced  ', email: 'spaced@example.com', name: 'Spaced' },
        { id: 102, username: 'UPPERCASE', email: 'upper@example.com', name: 'Upper' },
        { id: 103, username: '', email: 'empty@example.com', name: 'Empty' },
      ];

      respondLabels(edgeCaseLabels);
      usersJson(edgeCaseUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, ['spaced', 'UPPERCASE', '']);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(3);

      // Test that the mapping preserves exact content (including spaces and empty strings)
      expect(result.labelMap.get('  trimming  ')).toBe(1);
      expect(result.labelMap.get('special@chars')).toBe(2);
      expect(result.labelMap.get('')).toBe(3);

      expect(result.userMap.get('  spaced  ')).toBe(101);
      expect(result.userMap.get('uppercase')).toBe(102);
      expect(result.userMap.get('')).toBe(103);
    });

    it('should handle API client returning undefined users', async () => {
      // Arrange: an empty response body deserializes to `null` (see
      // vikunjaRestRequestRaw), matching the pre-migration
      // `getUsers.mockResolvedValue(undefined)` scenario (`|| []` fallback).
      respondLabels(mockLabels);
      usersRaw('');

      // Act
      const result = await resolver.resolveEntities(authManager, ['alice']);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(0);
      expect(result.projectLabels).toEqual(mockLabels);
      expect(result.projectUsers).toEqual([]);
    });

    it('should log debug information for successful resolution', async () => {
      // Arrange
      respondLabels(mockLabels);
      usersJson(mockUsers);

      // Act
      await resolver.resolveEntities(authManager, mockUsernames);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith('Labels fetched', {
        count: 3,
        labels: [
          { id: 1, title: 'Bug' },
          { id: 2, title: 'Feature' },
          { id: 3, title: 'Documentation' },
        ],
      });

      expect(logger.debug).toHaveBeenCalledWith('Users fetched', { searchCount: 3, count: 3 });

      expect(logger.debug).toHaveBeenCalledWith('Label and user maps created', {
        labelMapSize: 3,
        labelMapEntries: [
          ['bug', 1],
          ['feature', 2],
          ['documentation', 3],
        ],
        userMapSize: 3,
      });
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle label objects missing title property gracefully', async () => {
      // Arrange. Labels now arrive over a real JSON HTTP response — JSON has
      // no way to represent `undefined`, so `JSON.stringify` drops a
      // `title: undefined` key entirely rather than preserving it as
      // explicit-undefined. The pre-migration '[undefined]' sub-case is
      // therefore no longer reachable via `fetchLabels`; '[missing]',
      // '[null]', empty-string and valid-title are all still reachable and
      // covered below (mirrors the user edge-case test).
      const invalidLabels: any[] = [
        { id: 1, description: 'Missing title' }, // Missing title -> '[missing]'
        { id: 2, title: null, description: 'Null title' }, // Null title -> '[null]'
        { id: 3, title: '', description: 'Empty title' }, // Empty title -> ''
        { id: 5, title: 'Valid', description: 'Valid title' }, // Valid title
      ];

      respondLabels(invalidLabels);
      usersJson([]);

      // Act
      const result = await resolver.resolveEntities(authManager, ['nobody']);

      // Assert
      expect(result.labelMap.size).toBe(4);
      expect(result.labelMap.get('[missing]')).toBe(1); // missing title becomes '[missing]'
      expect(result.labelMap.get('[null]')).toBe(2); // null becomes '[null]'
      expect(result.labelMap.get('')).toBe(3); // empty string
      expect(result.labelMap.get('valid')).toBe(5);
    });

    it('should handle user objects missing username property gracefully', async () => {
      // Arrange. Users come from a real JSON HTTP response — JSON has no way
      // to represent `undefined`, so `JSON.stringify` drops such a key
      // entirely rather than preserving it as explicit-undefined. The
      // '[undefined]' sub-case is therefore not reachable here; '[missing]',
      // '[null]', empty-string, and valid-username are all still reachable
      // and covered below.
      const invalidUsers: any[] = [
        { id: 101, email: 'no-username@example.com' }, // Missing username
        { id: 102, username: null, email: 'null-username@example.com' }, // Null username
        { id: 103, username: '', email: 'empty-username@example.com' }, // Empty username
        { id: 105, username: 'validuser', email: 'valid@example.com' }, // Valid username
      ];

      respondLabels([]);
      usersJson(invalidUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, ['validuser']);

      // Assert
      expect(result.userMap.size).toBe(4);
      expect(result.userMap.get('[missing]')).toBe(101); // missing username becomes '[missing]'
      expect(result.userMap.get('[null]')).toBe(102); // null becomes '[null]'
      expect(result.userMap.get('')).toBe(103); // empty string
      expect(result.userMap.get('validuser')).toBe(105);
    });

    it('should preserve label and user objects in result for reference', async () => {
      // Arrange
      respondLabels(mockLabels);
      usersJson(mockUsers);

      // Act
      const result = await resolver.resolveEntities(authManager, mockUsernames);

      // Assert. Both labels and users now round-trip through JSON transport,
      // so the arrays are structurally equal to the source data rather than
      // the same object references.
      expect(result.projectLabels).toEqual(mockLabels);
      expect(result.projectUsers).toEqual(mockUsers);
      expect(result.projectLabels[0]).toEqual(mockLabels[0]);
    });
  });
});
