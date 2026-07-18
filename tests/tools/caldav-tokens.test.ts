/**
 * CalDAV Token Management Tool Tests
 *
 * vikunja_caldav_tokens routes all its HTTP calls through vikunjaRestRequest
 * (see src/utils/vikunja-rest.ts). Mocks global fetch directly, matching
 * tests/tools/tokens.test.ts's established convention for REST-based tools.
 */

import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerCaldavTokensTool } from '../../src/tools/caldav-tokens';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import type { CaldavToken } from '../../src/tools/caldav-tokens';
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

describe('CalDAV Tokens Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;

  const mockToken: CaldavToken = {
    id: 1,
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

    registerCaldavTokensTool(
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
    it('should list caldav tokens', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [mockToken] }));

      const result = await mockHandler({ subcommand: 'list' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/token/caldav',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        },
      );
      expect(result.content[0].text).toContain('**success:** true');
      expect(result.content[0].text).toContain('**count:** 1');
    });

    it('should handle an empty token list', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      const result = await mockHandler({ subcommand: 'list' });

      expect(result.content[0].text).toContain('**count:** 0');
    });

    it('should fall back to an empty array when the server returns no body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));

      const result = await mockHandler({ subcommand: 'list' });

      expect(result.content[0].text).toContain('**count:** 0');
    });
  });

  describe('create', () => {
    it('should create a caldav token with no request body and surface the one-time secret', async () => {
      const created = { ...mockToken, token: 'caldav-secretvalue' };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: created }));

      const result = await mockHandler({ subcommand: 'create' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/token/caldav',
        {
          method: 'PUT',
          headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        },
      );
      expect(result.content[0].text).toContain('created successfully');
      expect(result.content[0].text).toContain('store this now');
      expect(result.content[0].text).toContain('caldav-secretvalue');
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

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/token/caldav/7',
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        },
      );
      expect(result.content[0].text).toContain('CalDAV token 7 deleted successfully');
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
          'CalDAV token management was rejected by the server. Per docs/VIKUNJA_API_ISSUES.md, user-scoped endpoints have historically required JWT authentication — try reconnecting with a JWT via vikunja_auth.connect.',
        ),
      );
    });

    it('should throw a clear message when the server rejects with 403', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 403, statusText: 'Forbidden', body: { message: 'forbidden' } }),
      );

      await expect(mockHandler({ subcommand: 'list' })).rejects.toThrow(
        'CalDAV token management was rejected by the server',
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
          new MCPError(ErrorCode.API_ERROR, 'CalDAV token operation failed: unexpected failure'),
        );
      });

      it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string error';
        });

        await expect(mockHandler({ subcommand: 'delete', tokenId: 1 })).rejects.toThrow(
          new MCPError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred during CalDAV token operation'),
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
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'create' })),
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
