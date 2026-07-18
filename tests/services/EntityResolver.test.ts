import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EntityResolver, type EntityResolutionResult } from '../../src/services/EntityResolver';
import { MCPError } from '../../src/types/index';
import type { TypedVikunjaClient, Label, User } from '../../src/client';
import { AuthManager } from '../../src/auth/AuthManager';
import { logger } from '../../src/utils/logger';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Mock logger to avoid noise in tests
jest.mock('../../src/utils/logger');

// `fetchUsers` is migrated off node-vikunja onto the direct-REST helper
// (`GET /users`); `fetchLabels` (`client.labels.getLabels`) stays on the
// node-vikunja client — that domain's node-vikunja retirement is a separate
// item's scope.
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

/** Queues one successful JSON response for the next `fetch` call. */
function fetchOkOnce(body: unknown): void {
  mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(body) }));
}

describe('EntityResolver', () => {
  let resolver: EntityResolver;
  let mockClient: jest.Mocked<TypedVikunjaClient>;
  let authManager: AuthManager;

  // Mock data
  const mockLabels: Label[] = [
    { id: 1, title: 'Bug', description: 'Bug reports', color: '#ff0000' },
    { id: 2, title: 'Feature', description: 'New features', color: '#00ff00' },
    { id: 3, title: 'Documentation', description: 'Documentation tasks', color: '#0000ff' },
  ];

  const mockUsers: User[] = [
    { id: 101, username: 'alice', email: 'alice@example.com', name: 'Alice' },
    { id: 102, username: 'bob', email: 'bob@example.com', name: 'Bob' },
    { id: 103, username: 'charlie', email: 'charlie@example.com', name: 'Charlie' },
  ];

  beforeEach(() => {
    resolver = new EntityResolver();

    // Create a comprehensive mock client
    mockClient = {
      labels: {
        getLabels: jest.fn(),
      },
      users: {
        getUsers: jest.fn(),
      },
    } as jest.Mocked<TypedVikunjaClient>;

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    // Clear all mocks
    jest.clearAllMocks();
    mockFetch.mockReset();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats so one test's deliberately
    // failing scenario doesn't trip the breaker for a later test.
    circuitBreakerRegistry.clear();
  });

  describe('resolveEntities', () => {
    it('should successfully resolve both labels and users', async () => {
      // Arrange
      mockClient.labels.getLabels.mockResolvedValue(mockLabels);
      fetchOkOnce(mockUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(3);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual(mockLabels);
      expect(result.projectUsers).toEqual(mockUsers);

      // Verify the request hit GET /users with no search param, matching
      // the pre-migration `getUsers({})` call (see the KNOWN ISSUE comment
      // on EntityResolver.fetchUsers).
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/users',
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
      mockClient.labels.getLabels.mockResolvedValue([]);
      fetchOkOnce([]);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(0);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual([]);
    });

    it('should handle null label response', async () => {
      // Arrange
      mockClient.labels.getLabels.mockResolvedValue(null as any);
      fetchOkOnce(mockUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(mockUsers);
      expect(logger.warn).toHaveBeenCalledWith('Labels response is null/undefined');
    });

    it('should handle undefined label response', async () => {
      // Arrange
      mockClient.labels.getLabels.mockResolvedValue(undefined as any);
      fetchOkOnce(mockUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(mockUsers);
      expect(logger.warn).toHaveBeenCalledWith('Labels response is null/undefined');
    });

    it('should handle non-array label response', async () => {
      // Arrange
      mockClient.labels.getLabels.mockResolvedValue({ invalid: 'response' } as any);
      fetchOkOnce(mockUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(mockUsers);
      expect(logger.warn).toHaveBeenCalledWith('Labels response is not an array', expect.any(Object));
    });

    it('should handle authentication error for users', async () => {
      // Arrange: a real 401 response shape, classified via the explicit
      // `statusCode` check added for this migration (see EntityResolver's
      // fetchUsers — a plain MCPError from vikunjaRestRequest doesn't carry
      // the `.status`/`.response.status` properties isAuthenticationError's
      // structured checks look for).
      mockClient.labels.getLabels.mockResolvedValue(mockLabels);
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          text: 'missing, malformed, expired or otherwise invalid token provided',
        }),
      );

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

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
      mockClient.labels.getLabels.mockResolvedValue(mockLabels);
      // Not a message pattern isAuthenticationError/isRetryableError
      // recognizes, so this fails on the first attempt with no retries.
      mockFetch.mockRejectedValue(new Error('Service unavailable'));

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

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
      mockClient.labels.getLabels.mockRejectedValue(labelError);
      fetchOkOnce(mockUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(0);
      expect(result.userMap.size).toBe(3);
      expect(result.userFetchFailedDueToAuth).toBe(false);
      expect(result.projectLabels).toEqual([]);
      expect(result.projectUsers).toEqual(mockUsers);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch labels',
        expect.objectContaining({
          error: labelError.message,
        })
      );
    });

    it('should handle both label and user errors simultaneously', async () => {
      // Arrange
      const labelError = new Error('Label service down');
      mockClient.labels.getLabels.mockRejectedValue(labelError);
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 401, text: 'Auth failed' }),
      );

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

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
        { id: 1, title: '  Trimming  ', description: 'Spaces', color: '#ff0000' },
        { id: 2, title: 'Special@Chars', description: 'Special characters', color: '#00ff00' },
        { id: 3, title: '', description: 'Empty title', color: '#0000ff' },
      ];

      const edgeCaseUsers: User[] = [
        { id: 101, username: '  spaced  ', email: 'spaced@example.com', name: 'Spaced' },
        { id: 102, username: 'UPPERCASE', email: 'upper@example.com', name: 'Upper' },
        { id: 103, username: '', email: 'empty@example.com', name: 'Empty' },
      ];

      mockClient.labels.getLabels.mockResolvedValue(edgeCaseLabels);
      fetchOkOnce(edgeCaseUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

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
      mockClient.labels.getLabels.mockResolvedValue(mockLabels);
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(3);
      expect(result.userMap.size).toBe(0);
      expect(result.projectLabels).toEqual(mockLabels);
      expect(result.projectUsers).toEqual([]);
    });

    it('should log debug information for successful resolution', async () => {
      // Arrange
      mockClient.labels.getLabels.mockResolvedValue(mockLabels);
      fetchOkOnce(mockUsers);

      // Act
      await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith('Labels fetched', {
        count: 3,
        labels: [
          { id: 1, title: 'Bug' },
          { id: 2, title: 'Feature' },
          { id: 3, title: 'Documentation' },
        ],
      });

      expect(logger.debug).toHaveBeenCalledWith('Users fetched', { count: 3 });

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
      // Arrange
      const invalidLabels: any[] = [
        { id: 1, description: 'Missing title' }, // Missing title
        { id: 2, title: null, description: 'Null title' }, // Null title
        { id: 3, title: '', description: 'Empty title' }, // Empty title
        { id: 4, title: undefined, description: 'Undefined title' }, // Undefined title
        { id: 5, title: 'Valid', description: 'Valid title' }, // Valid title
      ];

      mockClient.labels.getLabels.mockResolvedValue(invalidLabels as any);
      fetchOkOnce([]);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.labelMap.size).toBe(5); // missing title, explicit undefined, null, empty string, and valid
      expect(result.labelMap.get('[missing]')).toBe(1); // missing title becomes '[missing]'
      expect(result.labelMap.get('[undefined]')).toBe(4); // explicit undefined becomes '[undefined]'
      expect(result.labelMap.get('[null]')).toBe(2); // null becomes '[null]'
      expect(result.labelMap.get('')).toBe(3); // empty string
      expect(result.labelMap.get('valid')).toBe(5);
    });

    it('should handle user objects missing username property gracefully', async () => {
      // Arrange. Unlike labels (still fetched via the node-vikunja client,
      // which can hand back a JS object with an explicit `undefined`
      // property), users now come from a real JSON HTTP response — JSON has
      // no way to represent `undefined`, so `JSON.stringify` drops such a
      // key entirely rather than preserving it as explicit-undefined. The
      // '[undefined]' sub-case from before this migration is therefore no
      // longer reachable via `fetchUsers` and is omitted here; '[missing]',
      // '[null]', empty-string, and valid-username are all still reachable
      // and covered below.
      const invalidUsers: any[] = [
        { id: 101, email: 'no-username@example.com' }, // Missing username
        { id: 102, username: null, email: 'null-username@example.com' }, // Null username
        { id: 103, username: '', email: 'empty-username@example.com' }, // Empty username
        { id: 105, username: 'validuser', email: 'valid@example.com' }, // Valid username
      ];

      mockClient.labels.getLabels.mockResolvedValue([]);
      fetchOkOnce(invalidUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.userMap.size).toBe(4);
      expect(result.userMap.get('[missing]')).toBe(101); // missing username becomes '[missing]'
      expect(result.userMap.get('[null]')).toBe(102); // null becomes '[null]'
      expect(result.userMap.get('')).toBe(103); // empty string
      expect(result.userMap.get('validuser')).toBe(105);
    });

    it('should preserve label and user objects in result for reference', async () => {
      // Arrange
      mockClient.labels.getLabels.mockResolvedValue(mockLabels);
      fetchOkOnce(mockUsers);

      // Act
      const result = await resolver.resolveEntities(mockClient, authManager);

      // Assert
      expect(result.projectLabels).toBe(mockLabels);
      expect(result.projectUsers).toEqual(mockUsers);
      expect(result.projectLabels[0]).toBe(mockLabels[0]);
    });
  });
});
