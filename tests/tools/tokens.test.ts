/**
 * API Token Management Tool Tests
 *
 * vikunja_tokens routes all its HTTP calls through vikunjaRestRequest (see
 * src/utils/vikunja-rest.ts). Mocks global fetch directly, matching
 * tests/tools/webhooks.test.ts's established convention for REST-based
 * tools.
 */

import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerTokensTool } from '../../src/tools/tokens';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import type { ApiToken } from '../../src/tools/tokens';
import * as validationUtils from '../../src/utils/validation';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

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

describe('Tokens Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;

  const mockToken: ApiToken = {
    id: 1,
    title: 'CI token',
    permissions: { tasks: ['read_all', 'update'] },
    created: '2023-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
    } as MockAuthManager;

    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-token',
    });

    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    registerTokensTool(
      mockServer as unknown as McpServer,
      mockAuthManager as unknown as AuthManager,
    );

    const calls = (mockServer.tool as jest.Mock).mock.calls;
    if (calls.length === 0) {
      throw new Error('Tool handler not found');
    }
    mockHandler = calls[0][calls[0].length - 1];
  });

  describe('Authentication', () => {
    it('should throw AUTH_REQUIRED when not authenticated', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(mockHandler({ subcommand: 'list' })).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should list tokens with no params', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [mockToken] }));

      const result = await mockHandler({ subcommand: 'list' });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/tokens', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      });
      expect(result.content[0].text).toContain('**success:** true');
      expect(result.content[0].text).toContain('**count:** 1');
    });

    it('should pass page/perPage/search as query params', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      await mockHandler({ subcommand: 'list', page: 2, perPage: 10, search: 'ci' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tokens?page=2&per_page=10&s=ci',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should handle an empty token list', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      const result = await mockHandler({ subcommand: 'list' });

      expect(result.content[0].text).toContain('**count:** 0');
    });
  });

  describe('create', () => {
    it('should require a title', async () => {
      await expect(
        mockHandler({ subcommand: 'create', permissions: { tasks: ['read_all'] } }),
      ).rejects.toThrow('title is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should require permissions', async () => {
      await expect(mockHandler({ subcommand: 'create', title: 'CI token' })).rejects.toThrow(
        'permissions is required',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should create a token with the exact expected payload', async () => {
      const created = { ...mockToken, token: 'tk_secretvalue' };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: created }));

      const result = await mockHandler({
        subcommand: 'create',
        title: 'CI token',
        permissions: { tasks: ['read_all', 'update'] },
        expiresAt: '2027-01-01T00:00:00Z',
        ownerId: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/tokens', {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'CI token',
          permissions: { tasks: ['read_all', 'update'] },
          expires_at: '2027-01-01T00:00:00Z',
          owner_id: 5,
        }),
      });
      expect(result.content[0].text).toContain('created successfully');
      expect(result.content[0].text).toContain('tk_secretvalue');
    });

    it('should create a token without optional fields', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockToken }));

      await mockHandler({
        subcommand: 'create',
        title: 'CI token',
        permissions: { tasks: ['read_all'] },
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/tokens', {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'CI token',
          permissions: { tasks: ['read_all'] },
        }),
      });
    });
  });

  describe('delete', () => {
    it('should require a valid tokenId', async () => {
      await expect(mockHandler({ subcommand: 'delete' })).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'tokenId must be a number or positive integer string'),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should delete a token by id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'deleted' } }));

      const result = await mockHandler({ subcommand: 'delete', tokenId: 7 });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/tokens/7', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      });
      expect(result.content[0].text).toContain('API token 7 deleted successfully');
    });
  });

  describe('error handling', () => {
    it('should throw a clear message when the server rejects with 401', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 401, statusText: 'Unauthorized', body: { message: 'invalid token' } }),
      );

      await expect(mockHandler({ subcommand: 'list' })).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          'API token management was rejected by the server. Per docs/VIKUNJA_API_ISSUES.md, user-scoped endpoints have historically required JWT authentication (tk_* API tokens are rejected) — try reconnecting with a JWT via vikunja_auth.connect.',
        ),
      );
    });

    it('should throw a validation error for an unknown subcommand', async () => {
      await expect(mockHandler({ subcommand: 'bogus' })).rejects.toThrow(
        'Unknown subcommand: bogus',
      );
    });

    // The generic Error/non-Error branches of the outer catch exist as a
    // safety net for failures that don't originate from vikunjaRestRequest
    // (which always throws MCPError). validateAndConvertId is one such
    // dependency; mock it to simulate an unexpected non-MCPError failure.
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

        await expect(mockHandler({ subcommand: 'delete', tokenId: 1 })).rejects.toThrow(
          new MCPError(ErrorCode.API_ERROR, 'Token operation failed: unexpected failure'),
        );
      });

      it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string error';
        });

        await expect(mockHandler({ subcommand: 'delete', tokenId: 1 })).rejects.toThrow(
          new MCPError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred during token operation'),
        );
      });
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects create/delete when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'create', title: 'x' })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'delete', tokenId: 1 })),
      ).toBe(true);
    });

    it('does not raise the read-only error for list when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list' }))).toBe(
        false,
      );
    });

    it('does not raise the read-only error for delete when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'delete', tokenId: 1 })),
      ).toBe(false);
    });
  });
});
