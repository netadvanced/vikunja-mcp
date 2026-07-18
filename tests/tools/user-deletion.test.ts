/**
 * User Self-Deletion Tool Tests
 *
 * vikunja_user_deletion routes all its HTTP calls through vikunjaRestRequest
 * (see src/utils/vikunja-rest.ts). Mocks global fetch directly, matching
 * tests/tools/admin.test.ts's established convention for REST-based tools.
 *
 * Extra coverage beyond the usual CRUD-tool shape: this tool handles
 * SECRETS (password/token), so several tests specifically assert those
 * values never leak into thrown error messages or logger calls.
 */

import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerUserDeletionTool } from '../../src/tools/user-deletion';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { logger } from '../../src/utils/logger';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

jest.mock('../../src/auth/AuthManager');

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const SECRET_PASSWORD = 'super-secret-password-1';
const SECRET_TOKEN = 'super-secret-email-token-1';

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

describe('User Deletion Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getAuthType: jest.fn().mockReturnValue('jwt'),
      getSession: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
    } as MockAuthManager;

    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-jwt-token',
    });

    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    registerUserDeletionTool(
      mockServer as unknown as McpServer,
      mockAuthManager as unknown as AuthManager,
    );

    const calls = (mockServer.tool as jest.Mock).mock.calls;
    if (calls.length === 0) {
      throw new Error('Tool handler not found');
    }
    mockHandler = calls[0][calls[0].length - 1];
  });

  describe('Authentication gating', () => {
    it('should throw AUTH_REQUIRED when not authenticated', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(
        mockHandler({ subcommand: 'request', password: SECRET_PASSWORD, confirm: true }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw PERMISSION_DENIED for API-token sessions', async () => {
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      await expect(
        mockHandler({ subcommand: 'request', password: SECRET_PASSWORD, confirm: true }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'User deletion operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('request', () => {
    it('should require confirm: true', async () => {
      await expect(
        mockHandler({ subcommand: 'request', password: SECRET_PASSWORD }),
      ).rejects.toThrow('Pass confirm: true to proceed');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should require password even when confirm is true', async () => {
      await expect(
        mockHandler({ subcommand: 'request', confirm: true }),
      ).rejects.toThrow('password is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should POST the password payload and confirm deletion has been requested', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'ok' } }));

      const result = await mockHandler({
        subcommand: 'request',
        password: SECRET_PASSWORD,
        confirm: true,
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/user/deletion/request', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: SECRET_PASSWORD }),
      });
      expect(result.content[0].text).toContain('Account deletion requested');
      expect(result.content[0].text).not.toContain(SECRET_PASSWORD);
    });

    it('should fall back to a null serverMessage when the server returns an empty body', async () => {
      // vikunjaRestRequest returns null for a 2xx response with no body
      // (src/utils/vikunja-rest.ts) — exercise the `result?.message ?? null`
      // fallback branch. formatObjectData drops null-valued entries, so the
      // success message is the only thing to assert on here.
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, body: undefined }));

      const result = await mockHandler({
        subcommand: 'request',
        password: SECRET_PASSWORD,
        confirm: true,
      });

      expect(result.content[0].text).toContain('Account deletion requested');
    });
  });

  describe('confirm', () => {
    it('should require confirm: true', async () => {
      await expect(
        mockHandler({ subcommand: 'confirm', token: SECRET_TOKEN }),
      ).rejects.toThrow('Pass confirm: true to proceed');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should require token even when confirm is true', async () => {
      await expect(
        mockHandler({ subcommand: 'confirm', confirm: true }),
      ).rejects.toThrow('token is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should POST the token payload and confirm deletion is scheduled', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'ok' } }));

      const result = await mockHandler({
        subcommand: 'confirm',
        token: SECRET_TOKEN,
        confirm: true,
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/user/deletion/confirm', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: SECRET_TOKEN }),
      });
      expect(result.content[0].text).toContain('Account deletion confirmed');
      expect(result.content[0].text).toContain('irreversible');
      expect(result.content[0].text).not.toContain(SECRET_TOKEN);
    });
  });

  describe('cancel', () => {
    it('should NOT require confirm: true (the safe undo leg)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'ok' } }));

      const result = await mockHandler({ subcommand: 'cancel', password: SECRET_PASSWORD });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/user/deletion/cancel', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: SECRET_PASSWORD }),
      });
      expect(result.content[0].text).toContain('canceled');
      expect(result.content[0].text).not.toContain(SECRET_PASSWORD);
    });

    it('should require password', async () => {
      await expect(mockHandler({ subcommand: 'cancel' })).rejects.toThrow('password is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('secret handling', () => {
    it('never logs password/token args (logger.debug only receives the subcommand)', async () => {
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'ok' } }));

      await mockHandler({ subcommand: 'request', password: SECRET_PASSWORD, confirm: true });

      expect(debugSpy).toHaveBeenCalledWith('User deletion tool called', { subcommand: 'request' });
      const loggedPayload = JSON.stringify(debugSpy.mock.calls);
      expect(loggedPayload).not.toContain(SECRET_PASSWORD);

      debugSpy.mockRestore();
    });

    it('never includes the password in a validation error for request', async () => {
      const error = await mockHandler({
        subcommand: 'request',
        password: SECRET_PASSWORD,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MCPError);
      expect((error as MCPError).message).not.toContain(SECRET_PASSWORD);
    });

    it('never includes the token in a validation error for confirm', async () => {
      const error = await mockHandler({
        subcommand: 'confirm',
        token: SECRET_TOKEN,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MCPError);
      expect((error as MCPError).message).not.toContain(SECRET_TOKEN);
    });

    it('never leaks the password through a wrapped HTTP error message', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 412,
          statusText: 'Precondition Failed',
          body: { message: 'Bad password provided.' },
        }),
      );

      const error = await mockHandler({
        subcommand: 'request',
        password: SECRET_PASSWORD,
        confirm: true,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MCPError);
      expect((error as MCPError).message).not.toContain(SECRET_PASSWORD);
    });
  });

  describe('error handling', () => {
    it('should throw a validation error for an unknown subcommand', async () => {
      await expect(mockHandler({ subcommand: 'bogus' })).rejects.toThrow('Unknown subcommand: bogus');
    });

    it('should wrap non-MCP errors as API_ERROR', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', body: { message: 'boom' } }),
      );

      await expect(
        mockHandler({ subcommand: 'cancel', password: SECRET_PASSWORD }),
      ).rejects.toThrow(MCPError);
    });

    it('should wrap a plain Error thrown by a dependency as an API_ERROR', async () => {
      mockFetch.mockImplementationOnce(() => {
        throw new Error('unexpected failure');
      });

      await expect(
        mockHandler({ subcommand: 'cancel', password: SECRET_PASSWORD }),
      ).rejects.toThrow(MCPError);
    });

    it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'ok' } }));
      const infoSpy = jest.spyOn(logger, 'info').mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'string error';
      });

      await expect(
        mockHandler({ subcommand: 'cancel', password: SECRET_PASSWORD }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'An unexpected error occurred during user deletion operation',
        ),
      );

      infoSpy.mockRestore();
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects request/confirm (destructive) when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, {
            subcommand: 'request',
            password: SECRET_PASSWORD,
            confirm: true,
          }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'confirm', token: SECRET_TOKEN, confirm: true }),
        ),
      ).toBe(true);
    });

    it('rejects cancel (write) when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'cancel', password: SECRET_PASSWORD }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for cancel when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { message: 'ok' } }));

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'cancel', password: SECRET_PASSWORD }),
        ),
      ).toBe(false);
    });
  });
});
