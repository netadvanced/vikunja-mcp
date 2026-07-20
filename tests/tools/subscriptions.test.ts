/**
 * Subscriptions Tool Tests
 *
 * subscriptions.ts routes every HTTP call through vikunjaRestRequest (see
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
import { registerSubscriptionsTool } from '../../src/tools/subscriptions';
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

describe('Subscriptions Tool', () => {
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

    registerSubscriptionsTool(
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
        mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: 1 }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
    });
  });

  describe('subscribe', () => {
    it('should PUT /subscriptions/{entity}/{entityID} for a task', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: 201, body: { id: 1, entity: 1, entity_id: 42 } }),
      );

      const result = await mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: 42 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/subscriptions/task/42',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**success:** true');
      expect(result.content[0].text).toContain('Subscribed to task 42');
    });

    it('should PUT /subscriptions/{entity}/{entityID} for a project', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: 201, body: { id: 2, entity: 0, entity_id: 7 } }),
      );

      await mockHandler({ subcommand: 'subscribe', entity: 'project', entityId: 7 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/subscriptions/project/7',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('the registered Zod schema should reject an entity kind other than project/task', () => {
      const schemaDef = (mockServer.tool as jest.Mock).mock.calls[0][2];
      const schema = z.object(schemaDef);

      const result = schema.safeParse({ subcommand: 'subscribe', entity: 'label', entityId: 1 });

      expect(result.success).toBe(false);
    });

    it('should throw a validation error for a non-positive entityId', async () => {
      await expect(
        mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: -1 }),
      ).rejects.toThrow();
    });

    it('should translate a 412 into a validation error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 412, statusText: 'Precondition Failed' }),
      );

      await expect(
        mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: 42 }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'Invalid subscription entity "task". Must be "project" or "task".',
        ),
      );
    });

    it('should translate a 403 into a permission-denied error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 403, statusText: 'Forbidden' }),
      );

      await expect(
        mockHandler({ subcommand: 'subscribe', entity: 'project', entityId: 7 }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'You do not have access to subscribe to project 7.',
        ),
      );
    });
  });

  describe('unsubscribe', () => {
    it('should DELETE /subscriptions/{entity}/{entityID}', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { id: 1, entity: 1, entity_id: 42 } }));

      const result = await mockHandler({ subcommand: 'unsubscribe', entity: 'task', entityId: 42 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/subscriptions/task/42',
        {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('Unsubscribed from task 42');
    });

    it('should treat a 404 as an idempotent no-op success (ensure-semantics)', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found' }),
      );

      const result = await mockHandler({ subcommand: 'unsubscribe', entity: 'task', entityId: 42 });

      expect(result.content[0].text).toContain('**success:** true');
      expect(result.content[0].text).toContain('Already not subscribed to task 42');
      expect(result.content[0].text).toContain('**count:** 0');
    });

    it('should still surface a non-404 error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 400, statusText: 'Bad Request' }),
      );

      await expect(
        mockHandler({ subcommand: 'unsubscribe', entity: 'task', entityId: 42 }),
      ).rejects.toThrow('HTTP 400');
    });

    it('should translate a 403 into a permission-denied error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 403, statusText: 'Forbidden' }),
      );

      await expect(
        mockHandler({ subcommand: 'unsubscribe', entity: 'task', entityId: 42 }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'You do not have access to subscribe to task 42.',
        ),
      );
    });
  });

  describe('error handling', () => {
    it('should handle unknown subcommand', async () => {
      await expect(
        mockHandler({ subcommand: 'unknown', entity: 'task', entityId: 1 }),
      ).rejects.toThrow(new MCPError(ErrorCode.VALIDATION_ERROR, 'Unknown subcommand: unknown'));
    });

    it('should surface a network failure (fetch rejects) as the MCPError vikunjaRestRequest already produced', async () => {
      mockFetch.mockRejectedValue(new Error('boom'));

      await expect(
        mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: 1 }),
      ).rejects.toThrow('Vikunja REST request failed (PUT /subscriptions/task/1): boom');
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
          mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: 1 }),
        ).rejects.toThrow(
          new MCPError(ErrorCode.API_ERROR, 'Subscriptions operation failed: unexpected failure'),
        );
      });

      it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string error';
        });

        await expect(
          mockHandler({ subcommand: 'subscribe', entity: 'task', entityId: 1 }),
        ).rejects.toThrow(
          new MCPError(
            ErrorCode.INTERNAL_ERROR,
            'An unexpected error occurred during a subscriptions operation',
          ),
        );
      });
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects subscribe/unsubscribe when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'subscribe', entity: 'task', entityId: 1 }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'unsubscribe', entity: 'task', entityId: 1 }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for subscribe when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'subscribe', entity: 'task', entityId: 1 }),
        ),
      ).toBe(false);
    });
  });
});
