/**
 * Instance Admin Tool Tests
 *
 * vikunja_admin routes all its HTTP calls through vikunjaRestRequest (see
 * src/utils/vikunja-rest.ts). Mocks global fetch directly, matching
 * tests/tools/webhooks.test.ts's established convention for REST-based
 * tools.
 */

import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerAdminTool } from '../../src/tools/admin';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import type { AdminUser } from '../../src/tools/admin';
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

describe('Admin Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;

  const mockAdminUser: AdminUser = {
    id: 1,
    username: 'alice',
    email: 'alice@example.com',
    is_admin: false,
    status: 0,
  };

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

    registerAdminTool(
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

      await expect(mockHandler({ subcommand: 'overview' })).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw PERMISSION_DENIED for API-token sessions', async () => {
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      await expect(mockHandler({ subcommand: 'overview' })).rejects.toThrow(
        new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'Admin operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('overview', () => {
    it('should fetch the admin overview', async () => {
      const overview = { users: 10, projects: 5, tasks: 200, teams: 2, shares: {}, license: {} };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: overview }));

      const result = await mockHandler({ subcommand: 'overview' });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/overview', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
      });
      expect(result.content[0].text).toContain('**success:** true');
    });
  });

  describe('list-projects', () => {
    it('should list all instance projects with query params', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [{ id: 1, title: 'P1' }] }));

      const result = await mockHandler({ subcommand: 'list-projects', page: 2, perPage: 5, search: 'p' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/admin/projects?page=2&per_page=5&s=p',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].text).toContain('**count:** 1');
    });
  });

  describe('set-project-owner', () => {
    it('should require projectId and ownerId', async () => {
      await expect(mockHandler({ subcommand: 'set-project-owner' })).rejects.toThrow(MCPError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should PATCH the owner_id payload', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { id: 1, title: 'P1', owner: { id: 9 } } }));

      const result = await mockHandler({ subcommand: 'set-project-owner', projectId: 1, ownerId: 9 });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/projects/1/owner', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: 9 }),
      });
      expect(result.content[0].text).toContain('reassigned to user 9');
    });
  });

  describe('list-users', () => {
    it('should list all instance users, exposing is_admin/status', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [mockAdminUser] }));

      const result = await mockHandler({ subcommand: 'list-users' });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/users', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
      });
      expect(result.content[0].text).toContain('**count:** 1');
    });

    it('should pass search/page/perPage as query params', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      await mockHandler({ subcommand: 'list-users', search: 'ali', page: 1, perPage: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/admin/users?s=ali&page=1&per_page=20',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('create-user', () => {
    it('should require username, email, and password', async () => {
      await expect(mockHandler({ subcommand: 'create-user', username: 'bob' })).rejects.toThrow(
        'username, email, and password are required',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should POST the exact expected payload', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { ...mockAdminUser, username: 'bob' } }));

      const result = await mockHandler({
        subcommand: 'create-user',
        username: 'bob',
        email: 'bob@example.com',
        password: 'supersecret1',
        name: 'Bob Bobson',
        language: 'en',
        isAdmin: true,
        skipEmailConfirm: true,
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/users', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'bob',
          email: 'bob@example.com',
          password: 'supersecret1',
          name: 'Bob Bobson',
          language: 'en',
          is_admin: true,
          skip_email_confirm: true,
        }),
      });
      expect(result.content[0].text).toContain("User 'bob' created successfully");
    });

    it('should POST a minimal payload without optional fields', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockAdminUser }));

      await mockHandler({
        subcommand: 'create-user',
        username: 'alice',
        email: 'alice@example.com',
        password: 'supersecret1',
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/users', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          email: 'alice@example.com',
          password: 'supersecret1',
        }),
      });
    });
  });

  describe('delete-user', () => {
    it('should require confirm: true', async () => {
      await expect(mockHandler({ subcommand: 'delete-user', userId: 3 })).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'Deleting a user is irreversible (in "now" mode). Pass confirm: true to proceed.',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should require a valid userId even when confirm is true', async () => {
      await expect(mockHandler({ subcommand: 'delete-user', confirm: true })).rejects.toThrow(MCPError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should delete with the default (scheduled) mode when confirmed', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 204 }));

      const result = await mockHandler({ subcommand: 'delete-user', userId: 3, confirm: true });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/users/3', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
      });
      expect(result.content[0].text).toContain('scheduled');
    });

    it('should pass mode=now as a query param when requested', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 204 }));

      const result = await mockHandler({
        subcommand: 'delete-user',
        userId: 3,
        confirm: true,
        mode: 'now',
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/users/3?mode=now', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
      });
      expect(result.content[0].text).toContain('completed immediately');
    });
  });

  describe('set-user-admin', () => {
    it('should require isAdmin', async () => {
      await expect(mockHandler({ subcommand: 'set-user-admin', userId: 1 })).rejects.toThrow(
        'isAdmin is required',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should PATCH the is_admin payload', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { ...mockAdminUser, is_admin: true } }));

      const result = await mockHandler({ subcommand: 'set-user-admin', userId: 1, isAdmin: true });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/admin/users/1/admin', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer test-jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_admin: true }),
      });
      expect(result.content[0].text).toContain('admin flag set to true');
    });

    it('should allow explicitly demoting a user (isAdmin: false)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { ...mockAdminUser, is_admin: false } }));

      await mockHandler({ subcommand: 'set-user-admin', userId: 1, isAdmin: false });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/admin/users/1/admin',
        expect.objectContaining({ body: JSON.stringify({ is_admin: false }) }),
      );
    });
  });

  describe('set-user-status', () => {
    it('should require status', async () => {
      await expect(mockHandler({ subcommand: 'set-user-status', userId: 1 })).rejects.toThrow(
        'status is required',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([
      ['active', 0],
      ['email-confirmation-required', 1],
      ['disabled', 2],
      ['account-locked', 3],
    ])('should convert status %s to the numeric wire value %d', async (status, numeric) => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: { ...mockAdminUser, status: numeric } }));

      await mockHandler({ subcommand: 'set-user-status', userId: 1, status });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/admin/users/1/status',
        expect.objectContaining({ body: JSON.stringify({ status: numeric }) }),
      );
    });
  });

  describe('error handling', () => {
    it('should throw a validation error for an unknown subcommand', async () => {
      await expect(mockHandler({ subcommand: 'bogus' })).rejects.toThrow(
        'Unknown subcommand: bogus',
      );
    });

    it('should wrap non-MCP errors as API_ERROR', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', body: { message: 'boom' } }),
      );

      await expect(mockHandler({ subcommand: 'overview' })).rejects.toThrow(MCPError);
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

        await expect(
          mockHandler({ subcommand: 'delete-user', userId: 1, confirm: true }),
        ).rejects.toThrow(new MCPError(ErrorCode.API_ERROR, 'Admin operation failed: unexpected failure'));
      });

      it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string error';
        });

        await expect(
          mockHandler({ subcommand: 'delete-user', userId: 1, confirm: true }),
        ).rejects.toThrow(
          new MCPError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred during admin operation'),
        );
      });
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects write/destructive subcommands when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'set-project-owner', projectId: 1, ownerId: 2 }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'delete-user', userId: 1, confirm: true }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for overview/list-projects/list-users when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'overview' }))).toBe(
        false,
      );
      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list-projects' })),
      ).toBe(false);
      expect(isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list-users' }))).toBe(
        false,
      );
    });

    it('does not raise the read-only error for delete-user when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'delete-user', userId: 1, confirm: true }),
        ),
      ).toBe(false);
    });
  });
});
