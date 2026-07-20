/**
 * Tests for the oidc-http mode `vikunja_auth` provisioning subcommands
 * (`provision` / `deprovision` / identity-scoped `status`) — item H2b.
 *
 * These subcommands only activate when `getCurrentIdentity()` returns a
 * value (i.e. inside the ALS scope the OIDC HTTP auth middleware opens);
 * outside of one (stdio mode, always) they are rejected with a clear error
 * pointing at connect/disconnect instead, and `status` falls back to the
 * pre-existing global-session behavior — see tests/tools/auth.test.ts for
 * that stdio-mode coverage, left untouched.
 */

import { registerAuthTool } from '../../src/tools/auth';
import type { MockServer, MockAuthManager } from '../types/mocks';

jest.mock('../../src/client', () => ({
  clearGlobalClientFactory: jest.fn(),
}));

jest.mock('../../src/middleware/direct-middleware', () => ({
  applyRateLimiting: jest.fn((toolName, handler) => handler),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockVikunjaRestRequest = jest.fn();
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: (...args: unknown[]) => mockVikunjaRestRequest(...args),
}));

const mockGetCurrentIdentity = jest.fn();
jest.mock('../../src/context/requestContext', () => ({
  getCurrentIdentity: (...args: unknown[]) => mockGetCurrentIdentity(...args),
}));

const mockGetVaultCredentialSource = jest.fn();
jest.mock('../../src/auth/oidc/vaultCredentialSource', () => ({
  getVaultCredentialSource: (...args: unknown[]) => mockGetVaultCredentialSource(...args),
}));

describe('vikunja_auth oidc-http provisioning subcommands', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let toolHandler: (args: any) => Promise<any>;

  const ALICE = { issuer: 'https://idp.example.test', sub: 'alice-sub' };

  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    return toolHandler({ subcommand, ...args });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockVikunjaRestRequest.mockReset();
    mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
      if (path === '/info') {
        return { version: '1.2.3' };
      }
      return [];
    });

    mockGetCurrentIdentity.mockReset();
    mockGetVaultCredentialSource.mockReset();

    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    mockAuthManager = {
      connect: jest.fn(),
      getStatus: jest.fn(),
      isConnected: jest.fn(),
      getSession: jest.fn(),
      disconnect: jest.fn(),
      isAuthenticated: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
      getAuthType: jest.fn(),
    } as MockAuthManager;

    registerAuthTool(mockServer, mockAuthManager);
    toolHandler = mockServer.tool.mock.calls[0][mockServer.tool.mock.calls[0].length - 1];
  });

  describe('provision', () => {
    it('rejects with a clear error when there is no OIDC identity (stdio mode)', async () => {
      mockGetCurrentIdentity.mockReturnValue(undefined);
      await expect(callTool('provision', { apiToken: 'tk_x' })).rejects.toThrow(
        /only available in oidc-http mode/,
      );
    });

    it('rejects when apiToken is missing', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      await expect(callTool('provision', {})).rejects.toThrow('apiToken is required');
    });

    it('rejects when the vault is not configured', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      mockGetVaultCredentialSource.mockReturnValue(undefined);
      await expect(callTool('provision', { apiToken: 'tk_x' })).rejects.toThrow(
        /credential vault is not configured/,
      );
    });

    it('verifies the token against Vikunja before storing, then provisions it', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = {
        getVikunjaUrl: jest.fn().mockReturnValue('http://localhost:33456/api/v1'),
        provision: jest.fn(),
      };
      mockGetVaultCredentialSource.mockReturnValue(vault);

      const result = await callTool('provision', { apiToken: 'tk_alice-real-token' });

      expect(mockVikunjaRestRequest).toHaveBeenCalledWith(expect.anything(), 'GET', '/info');
      expect(vault.provision).toHaveBeenCalledWith(
        ALICE,
        'tk_alice-real-token',
        'http://localhost:33456/api/v1',
      );
      const markdown = result.content[0].text;
      expect(markdown).toContain('linked');
      expect(markdown).not.toContain('tk_alice-real-token');
      expect(markdown).toContain('tk_a...');
    });

    it('does not provision when Vikunja rejects the supplied token', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = {
        getVikunjaUrl: jest.fn().mockReturnValue('http://localhost:33456/api/v1'),
        provision: jest.fn(),
      };
      mockGetVaultCredentialSource.mockReturnValue(vault);
      mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
        if (path === '/info') {
          return { version: '1.2.3' };
        }
        throw new Error('401 unauthorized');
      });

      await expect(callTool('provision', { apiToken: 'tk_bad-token' })).rejects.toThrow(
        /token was rejected/,
      );
      expect(vault.provision).not.toHaveBeenCalled();
    });

    it('rejects when the server has no VIKUNJA_URL configured', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = {
        getVikunjaUrl: jest.fn().mockReturnValue(''),
        provision: jest.fn(),
      };
      mockGetVaultCredentialSource.mockReturnValue(vault);

      await expect(callTool('provision', { apiToken: 'tk_x' })).rejects.toThrow(
        /no VIKUNJA_URL configured/,
      );
    });
  });

  describe('deprovision', () => {
    it('rejects with a clear error when there is no OIDC identity (stdio mode)', async () => {
      mockGetCurrentIdentity.mockReturnValue(undefined);
      await expect(callTool('deprovision')).rejects.toThrow(/only available in oidc-http mode/);
    });

    it('rejects when the vault is not configured', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      mockGetVaultCredentialSource.mockReturnValue(undefined);
      await expect(callTool('deprovision')).rejects.toThrow(/credential vault is not configured/);
    });

    it('reports success when a record existed and was removed', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = { deprovision: jest.fn().mockReturnValue(true) };
      mockGetVaultCredentialSource.mockReturnValue(vault);

      const result = await callTool('deprovision');
      expect(vault.deprovision).toHaveBeenCalledWith(ALICE);
      expect(result.content[0].text).toContain('unlinked');
    });

    it('reports no-op (not an error) when there was nothing to remove', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = { deprovision: jest.fn().mockReturnValue(false) };
      mockGetVaultCredentialSource.mockReturnValue(vault);

      const result = await callTool('deprovision');
      expect(result.content[0].text).toContain('No linked Vikunja API token was found');
    });
  });

  describe('status (identity-scoped, oidc-http mode)', () => {
    it('reports linked:false for an unprovisioned identity', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = { status: jest.fn().mockReturnValue({ linked: false }) };
      mockGetVaultCredentialSource.mockReturnValue(vault);

      const result = await callTool('status');
      expect(vault.status).toHaveBeenCalledWith(ALICE);
      expect(result.content[0].text).toContain('Not linked');
    });

    it('reports linked:true with a masked token for a provisioned identity', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      const vault = {
        status: jest.fn().mockReturnValue({
          linked: true,
          maskedToken: 'tk_a...',
          provisionedAt: '2026-01-01T00:00:00.000Z',
        }),
      };
      mockGetVaultCredentialSource.mockReturnValue(vault);

      const result = await callTool('status');
      const markdown = result.content[0].text;
      expect(markdown).toContain('tk_a...');
      expect(markdown).not.toMatch(/tk_[a-zA-Z0-9-]{5,}\.\.\./); // no full un-masked token leaks
    });

    it('falls back to the global session status when the vault is unconfigured but an identity is present', async () => {
      mockGetCurrentIdentity.mockReturnValue(ALICE);
      mockGetVaultCredentialSource.mockReturnValue(undefined);

      const result = await callTool('status');
      expect(result.content[0].text).toContain('Not linked');
    });

    it('falls back to legacy global-session status outside oidc-http mode (stdio)', async () => {
      mockGetCurrentIdentity.mockReturnValue(undefined);
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });

      const result = await callTool('status');
      expect(mockAuthManager.getStatus).toHaveBeenCalled();
      expect(result.content[0].text).toContain('Not authenticated');
    });
  });
});
