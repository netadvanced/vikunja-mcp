/**
 * Reactions Tool Tests
 *
 * reactions.ts routes every HTTP call through vikunjaRestRequest (see
 * src/utils/vikunja-rest.ts), which normalizes the configured apiUrl to
 * always include the `/api/v1` prefix. These tests mock global fetch the
 * same way tests/tools/webhooks.test.ts does, and assert against the
 * normalized `/api/v1/...` URLs AND the exact outgoing request bodies
 * (docs/ENDPOINT-PLAYBOOK.md §6).
 */

import { jest } from '@jest/globals';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerReactionsTool } from '../../src/tools/reactions';
import { MCPError, ErrorCode } from '../../src/types';
import { getAuthManagerFromContext } from '../../src/client';
import * as validationUtils from '../../src/utils/validation';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
  hasRequestContext: jest.fn(() => false),
}));
jest.mock('../../src/auth/AuthManager');

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

function mockResponse(opts: { ok?: boolean; status?: number; statusText?: string; body?: unknown }): Response {
  const { ok = true, status = 200, statusText = 'OK', body } = opts;
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('Reactions Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;
  let mockClient: MockVikunjaClient;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
    } as MockVikunjaClient;

    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
    } as MockAuthManager;

    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(mockClient);

    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-token',
    });

    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

    registerReactionsTool(
      mockServer as unknown as McpServer,
      mockAuthManager as unknown as AuthManager,
    );

    const calls = (mockServer.tool as jest.Mock).mock.calls;
    if (calls.length > 0) {
      mockHandler = calls[0][calls[0].length - 1];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('Authentication', () => {
    it('should throw error when not authenticated', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(
        mockHandler({ subcommand: 'list', kind: 'tasks', entityId: 1 }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
    });
  });

  describe('list', () => {
    it('should GET /{kind}/{id}/reactions for a task', async () => {
      const reactions = [{ '👍': [{ id: 1, username: 'alice' }] }];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: reactions }));

      const result = await mockHandler({ subcommand: 'list', kind: 'tasks', entityId: 7 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/7/reactions',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**success:** true');
      expect(result.content[0].text).toContain('**count:** 1');
    });

    it('should GET /{kind}/{id}/reactions for a comment', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      const result = await mockHandler({ subcommand: 'list', kind: 'comments', entityId: 3 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/comments/3/reactions',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].text).toContain('**count:** 0');
    });

    it('should default to an empty array when the API returns no body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, body: undefined }));

      const result = await mockHandler({ subcommand: 'list', kind: 'tasks', entityId: 7 });

      expect(result.content[0].text).toContain('**count:** 0');
    });

    it('the registered Zod schema should reject a kind other than tasks/comments', () => {
      const schemaDef = (mockServer.tool as jest.Mock).mock.calls[0][2];
      const schema = z.object(schemaDef);

      const result = schema.safeParse({ subcommand: 'list', kind: 'projects', entityId: 1 });

      expect(result.success).toBe(false);
    });
  });

  describe('add', () => {
    it('should PUT the reaction value in the request body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ body: { value: '👍', created: '2026-01-01T00:00:00Z' } }),
      );

      const result = await mockHandler({
        subcommand: 'add',
        kind: 'tasks',
        entityId: 7,
        value: '👍',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/7/reactions',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: '👍' }),
        },
      );
      expect(result.content[0].text).toContain('Reaction "👍" added to tasks 7');
    });

    it('should require a value', async () => {
      await expect(
        mockHandler({ subcommand: 'add', kind: 'tasks', entityId: 7 }),
      ).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'value is required for adding a reaction'),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('the registered Zod schema should reject a value longer than 20 characters', () => {
      const schemaDef = (mockServer.tool as jest.Mock).mock.calls[0][2];
      const schema = z.object(schemaDef);

      const result = schema.safeParse({
        subcommand: 'add',
        kind: 'tasks',
        entityId: 7,
        value: 'x'.repeat(21),
      });

      expect(result.success).toBe(false);
    });

    it('should translate a 403 into a permission-denied error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 403, statusText: 'Forbidden' }),
      );

      await expect(
        mockHandler({ subcommand: 'add', kind: 'tasks', entityId: 7, value: '👍' }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'You do not have access to reactions on tasks 7.',
        ),
      );
    });
  });

  describe('remove', () => {
    it('should POST the reaction value to the delete endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ body: { message: 'The reaction was successfully removed.' } }),
      );

      const result = await mockHandler({
        subcommand: 'remove',
        kind: 'comments',
        entityId: 3,
        value: '❤️',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/comments/3/reactions/delete',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: '❤️' }),
        },
      );
      expect(result.content[0].text).toContain('The reaction was successfully removed.');
    });

    it('should require a value', async () => {
      await expect(
        mockHandler({ subcommand: 'remove', kind: 'tasks', entityId: 7 }),
      ).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'value is required for removing a reaction'),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fall back to a default message when the API returns no message field', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: {} }));

      const result = await mockHandler({
        subcommand: 'remove',
        kind: 'tasks',
        entityId: 7,
        value: '👍',
      });

      expect(result.content[0].text).toContain('Reaction "👍" removed from tasks 7');
    });
  });

  describe('error handling', () => {
    it('should handle unknown subcommand', async () => {
      await expect(
        mockHandler({ subcommand: 'unknown', kind: 'tasks', entityId: 1 }),
      ).rejects.toThrow(new MCPError(ErrorCode.VALIDATION_ERROR, 'Unknown subcommand: unknown'));
    });

    it('should throw a validation error for a non-positive entityId', async () => {
      await expect(
        mockHandler({ subcommand: 'list', kind: 'tasks', entityId: -1 }),
      ).rejects.toThrow(new MCPError(ErrorCode.VALIDATION_ERROR, 'entityId must be a positive integer'));
    });

    it('should surface a network failure (fetch rejects) as the MCPError vikunjaRestRequest already produced', async () => {
      mockFetch.mockRejectedValue(new Error('boom'));

      await expect(
        mockHandler({ subcommand: 'list', kind: 'tasks', entityId: 7 }),
      ).rejects.toThrow('Vikunja REST request failed (GET /tasks/7/reactions): boom');
    });

    describe('unexpected (non-MCPError) failures from other dependencies', () => {
      let validateAndConvertIdSpy: jest.SpiedFunction<typeof validationUtils.validateAndConvertId>;

      beforeEach(() => {
        validateAndConvertIdSpy = jest.spyOn(validationUtils, 'validateAndConvertId');
      });

      afterEach(() => {
        validateAndConvertIdSpy.mockRestore();
      });

      it('should wrap a plain Error as an API_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          throw new Error('unexpected failure');
        });

        await expect(
          mockHandler({ subcommand: 'list', kind: 'tasks', entityId: 1 }),
        ).rejects.toThrow(
          new MCPError(ErrorCode.API_ERROR, 'Reactions operation failed: unexpected failure'),
        );
      });

      it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string error';
        });

        await expect(
          mockHandler({ subcommand: 'list', kind: 'tasks', entityId: 1 }),
        ).rejects.toThrow(
          new MCPError(
            ErrorCode.INTERNAL_ERROR,
            'An unexpected error occurred during a reactions operation',
          ),
        );
      });
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects add/remove when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'add', kind: 'tasks', entityId: 1, value: '👍' }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, {
            subcommand: 'remove',
            kind: 'tasks',
            entityId: 1,
            value: '👍',
          }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for list when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'list', kind: 'tasks', entityId: 1 }),
        ),
      ).toBe(false);
    });

    it('does not raise the read-only error for add when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'add', kind: 'tasks', entityId: 1, value: '👍' }),
        ),
      ).toBe(false);
    });
  });
});
