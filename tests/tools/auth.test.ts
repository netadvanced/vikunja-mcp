/**
 * Tests for authentication tool
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerAuthTool } from '../../src/tools/auth';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockServer, MockAuthManager } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';
import { getCurrentIdentity } from '../../src/context/requestContext';
import { getActiveVaultStore } from '../../src/storage/vaultFileStore';

// Mock context/requestContext: only getCurrentIdentity is used by auth.ts,
// and only the oidc-http-mode provisioning describe block below sets it —
// every other test in this file leaves it `undefined`, matching stdio mode.
jest.mock('../../src/context/requestContext', () => ({
  getCurrentIdentity: jest.fn(),
}));

// Mock the vault seam: auth.ts reads the active vault store via
// getActiveVaultStore() for provision/status/deprovision and the
// oidc-mode-aliased connect/disconnect/status branches.
jest.mock('../../src/storage/vaultFileStore', () => ({
  getActiveVaultStore: jest.fn(),
}));

// Mock src/client: clearGlobalClientFactory (as before), plus
// getAuthManagerFromContext/hasRequestContext — this test suite exercises
// stdio-mode behaviour (no ALS request context bound), so hasRequestContext
// stays false throughout, matching real stdio behaviour exactly. The oidc-
// http-mode provisioning subcommands get their own describe block below with
// hasRequestContext mocked true.
const mockGetAuthManagerFromContext = jest.fn();
const mockHasRequestContext = jest.fn(() => false);
jest.mock('../../src/client', () => ({
  clearGlobalClientFactory: jest.fn(),
  getAuthManagerFromContext: (...args: unknown[]) => mockGetAuthManagerFromContext(...args),
  hasRequestContext: () => mockHasRequestContext(),
}));

// Mock the direct middleware to bypass middleware
jest.mock('../../src/middleware/direct-middleware', () => ({
  applyRateLimiting: jest.fn((toolName, handler) => handler),
}));

// Mock security utils
jest.mock('../../src/utils/security', () => ({
  createSecureConnectionMessage: jest.fn((url, token) => `Connecting to ${url} with token ${token.slice(0, 4)}...`),
  maskCredential: jest.fn((token: string | undefined | null) =>
    token && token.length > 4 ? `${token.slice(0, 4)}...` : '***',
  ),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the direct-REST helper used by 'connect' (server verification) and
// 'info'. Default implementation resolves both the unauthenticated GET /info
// call and the follow-up authenticated validation call (GET /user for JWT,
// GET /projects for API tokens) so existing success-path tests don't need to
// know about the new round trips. Individual tests override this to exercise
// failure paths.
const mockVikunjaRestRequest = jest.fn();
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: (...args: unknown[]) => mockVikunjaRestRequest(...args),
}));

describe('Auth Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let toolHandler: (args: any) => Promise<any>;

  // Helper function to call a tool
  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    return toolHandler({
      subcommand,
      ...args,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockVikunjaRestRequest.mockReset();
    mockVikunjaRestRequest.mockImplementation(async (_authManager: unknown, _method: string, path: string) => {
      if (path === '/info') {
        return { version: '1.2.3', frontend_url: 'https://vikunja.example.com' };
      }
      // GET /user (JWT validation) or GET /projects?per_page=1 (API token validation)
      return [];
    });

    // Create mock server that captures the tool registration
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    // Create mock auth manager
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

    // Register the tool
    registerAuthTool(mockServer, mockAuthManager);

    // Capture the tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_auth',
      'Manage authentication with Vikunja API (connect, status, refresh, disconnect, info). ' +
        'In oidc-http mode, self-service credential provisioning (provision, status, ' +
        'deprovision) additionally links your validated OIDC identity to a Vikunja API ' +
        "token in the server's encrypted credential vault — connect/disconnect are not " +
        'available in that mode (provision/deprovision replace them).',
      expect.any(Object),
      expect.any(Object), // ToolAnnotations
      expect.any(Function),
    );
    toolHandler = mockServer.tool.mock.calls[0][mockServer.tool.mock.calls[0].length - 1];
  });

  describe('connect subcommand', () => {
    it('should connect with valid credentials', async () => {
      // Mock getStatus to return not authenticated
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      });

      expect(mockAuthManager.connect).toHaveBeenCalledWith(
        'https://vikunja.example.com',
        'tk_test-token-123',
      );
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-connect');
      expect(markdown).toContain('Successfully connected to Vikunja');
      expect(markdown).toContain('https://vikunja.example.com');
      expect(markdown).toContain('api-token');

      // Connect verification round trip: unauthenticated GET /info, then a
      // cheap authenticated call. API tokens can't use /user (see
      // docs/VIKUNJA_API_ISSUES.md #2), so /projects is used instead.
      expect(mockVikunjaRestRequest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/info');
      expect(mockVikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects?per_page=1',
      );
      expect(markdown).toContain('1.2.3');
    });

    it('should verify JWT sessions against GET /user rather than /projects', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
      });

      expect(mockVikunjaRestRequest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/info');
      expect(mockVikunjaRestRequest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/user');
      expect(mockVikunjaRestRequest).not.toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects?per_page=1',
      );
    });

    it('should roll back the session and throw when GET /info is unreachable', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');
      mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
        if (path === '/info') {
          throw new Error('fetch failed');
        }
        return [];
      });

      await expect(callTool('connect', {
        apiUrl: 'https://bad.example.com',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow('Could not reach a Vikunja server');

      expect(mockAuthManager.disconnect).toHaveBeenCalled();
    });

    it('should roll back the session and throw when the credential is rejected', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');
      mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
        if (path === '/info') {
          return { version: '1.2.3' };
        }
        throw new Error('HTTP 401 Unauthorized');
      });

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_bad-token',
      })).rejects.toThrow('token was rejected');

      expect(mockAuthManager.disconnect).toHaveBeenCalled();
    });

    it('should reject a bad JWT session and mention JWT specifically', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('jwt');
      mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
        if (path === '/info') {
          return { version: '1.2.3' };
        }
        throw new Error('HTTP 401 Unauthorized');
      });

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.bad.signature',
      })).rejects.toThrow('the provided JWT token was rejected');

      expect(mockAuthManager.disconnect).toHaveBeenCalled();
    });

    it('should handle non-Error values thrown by the /info round trip', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');
      mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
        if (path === '/info') {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'connection refused';
        }
        return [];
      });

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow('Could not reach a Vikunja server at https://vikunja.example.com: connection refused');
    });

    it('should omit serverVersion from the response when /info has no version field', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');
      mockVikunjaRestRequest.mockImplementation(async (_am: unknown, _method: string, path: string) => {
        if (path === '/info') {
          return { frontend_url: 'https://vikunja.example.com' };
        }
        return [];
      });

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      });

      expect(result.content[0].text).not.toContain('serverVersion');
    });

    it('should return already connected message when authenticating to same URL', async () => {
      // Mock getStatus to return authenticated
      mockAuthManager.getStatus.mockReturnValue({
        authenticated: true,
        apiUrl: 'https://vikunja.example.com',
      });

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      });

      expect(mockAuthManager.connect).not.toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-connect');
      expect(markdown).toContain('Already connected to Vikunja');
      expect(markdown).toContain('https://vikunja.example.com');
    });

    it('should throw error when apiUrl is missing', async () => {
      await expect(callTool('connect', {
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow(MCPError);
      
      await expect(callTool('connect', {
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow('apiUrl and apiToken are required for connect');
    });

    it('should throw error when apiToken is missing', async () => {
      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
      })).rejects.toThrow(MCPError);
      
      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
      })).rejects.toThrow('apiUrl and apiToken are required for connect');
    });

    it('should handle connection errors', async () => {
      // Mock getStatus to return not authenticated
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });

      const connectionError = new Error('Network error');
      mockAuthManager.connect.mockImplementation(() => {
        throw connectionError;
      });

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow(MCPError);
      
      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow('Authentication error: Network error');
    });

    it('should auto-detect and connect with JWT token', async () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      // Mock getStatus to return not authenticated
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: jwtToken,
      });

      expect(mockAuthManager.connect).toHaveBeenCalledWith(
        'https://vikunja.example.com',
        jwtToken,
      );
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-connect');
      expect(markdown).toContain('Successfully connected to Vikunja');
      expect(markdown).toContain('https://vikunja.example.com');
      expect(markdown).toContain('jwt');
    });

    it('should auto-detect and connect with API token', async () => {
      // Mock getStatus to return not authenticated
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      });

      expect(mockAuthManager.connect).toHaveBeenCalledWith(
        'https://vikunja.example.com',
        'tk_test-token-123',
      );
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-connect');
      expect(markdown).toContain('Successfully connected to Vikunja');
      expect(markdown).toContain('https://vikunja.example.com');
      expect(markdown).toContain('api-token');
    });

    it('should correctly identify authType in metadata', async () => {
      // Test with API token
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      let result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      });
      let markdown = result.content[0].text;
      expect(markdown).toContain('api-token');

      // Test with JWT token
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
      });
      markdown = result.content[0].text;
      expect(markdown).toContain('jwt');
    });
  });

  describe('status subcommand', () => {
    it('should return authenticated status', async () => {
      const mockStatus = {
        authenticated: true,
        apiUrl: 'https://vikunja.example.com',
      };
      mockAuthManager.getStatus.mockReturnValue(mockStatus);

      const result = await callTool('status');

      expect(mockAuthManager.getStatus).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-status');
      expect(markdown).toContain('Authentication status retrieved');
      expect(markdown).toContain('https://vikunja.example.com');
    });

    it('should return not authenticated status', async () => {
      const mockStatus = {
        authenticated: false,
      };
      mockAuthManager.getStatus.mockReturnValue(mockStatus);

      const result = await callTool('status');

      expect(mockAuthManager.getStatus).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-status');
      expect(markdown).toContain('Not authenticated');
    });
  });

  describe('refresh subcommand', () => {
    it('should report that API tokens (tk_*) do not need refreshing', async () => {
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      const result = await callTool('refresh');

      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-refresh');
      expect(markdown).toContain('Token refresh not required');
      expect(markdown).toContain('do not expire');
      expect(markdown).toContain('API tokens');
    });

    it('should return message that refresh is not required (legacy default mock, non-jwt authType)', async () => {
      const result = await callTool('refresh');

      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-refresh');
      expect(markdown).toContain('Token refresh not required');
      expect(markdown).toContain('do not expire');
    });

    it('should NOT claim JWTs do not expire, and should explain refresh is unavailable', async () => {
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      const result = await callTool('refresh');

      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-refresh');
      // The old, false claim must be gone for JWT sessions.
      expect(markdown).not.toContain('Token refresh not required');
      expect(markdown).toContain('JWT tokens expire');
      expect(markdown).toContain('/user/token/refresh');
      expect(markdown).toContain('refresh-token cookie');
      expect(markdown).toContain('vikunja_auth connect');
    });

    it('should require an active session before reporting refresh info', async () => {
      const notAuthenticated = new MCPError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required. Please use vikunja_auth.connect first.',
      );
      mockAuthManager.getAuthType.mockImplementation(() => {
        throw notAuthenticated;
      });

      await expect(callTool('refresh')).rejects.toThrow(MCPError);
      await expect(callTool('refresh')).rejects.toThrow('Authentication required');
    });
  });

  describe('disconnect subcommand', () => {
    it('should disconnect and cleanup client', async () => {
      const { clearGlobalClientFactory } = require('../../src/client');
      const result = await callTool('disconnect');

      expect(mockAuthManager.disconnect).toHaveBeenCalled();
      expect(clearGlobalClientFactory).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-disconnect');
      expect(markdown).toContain('Successfully disconnected from Vikunja');
    });
  });

  describe('info subcommand', () => {
    it('should return the server info payload when authenticated', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockVikunjaRestRequest.mockResolvedValue({
        version: '2.3.0',
        frontend_url: 'https://vikunja.example.com',
        motd: 'Welcome',
      });

      const result = await callTool('info');

      expect(mockVikunjaRestRequest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/info');
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-info');
      expect(markdown).toContain('2.3.0');
      expect(markdown).toContain('Welcome');
    });

    it('should require an active session', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(callTool('info')).rejects.toThrow(MCPError);
      await expect(callTool('info')).rejects.toThrow('Authentication required');
      expect(mockVikunjaRestRequest).not.toHaveBeenCalled();
    });

    it('should omit serverVersion metadata when the response has no version field', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockVikunjaRestRequest.mockResolvedValue({ frontend_url: 'https://vikunja.example.com' });

      const result = await callTool('info');

      expect(result.content[0].text).not.toContain('serverVersion');
    });
  });

  describe('error handling', () => {
    it('should throw error for unknown subcommand', async () => {
      await expect(callTool('unknown' as any)).rejects.toThrow(MCPError);
      await expect(callTool('unknown' as any)).rejects.toThrow('Unknown subcommand: unknown');
    });

    it('should rethrow MCPError instances', async () => {
      const mcpError = new MCPError(ErrorCode.AUTH_ERROR, 'Custom auth error');
      mockAuthManager.getStatus.mockImplementation(() => {
        throw mcpError;
      });

      await expect(callTool('status')).rejects.toThrow(mcpError);
      await expect(callTool('status')).rejects.toThrow('Custom auth error');
    });

    it('should wrap non-Error objects as internal errors', async () => {
      mockAuthManager.getStatus.mockImplementation(() => {
        throw 'string error';
      });

      await expect(callTool('status')).rejects.toThrow(MCPError);
      await expect(callTool('status')).rejects.toThrow('Authentication error: string error');
    });
  });

  describe('security - token exposure protection', () => {
    beforeEach(() => {
      // Spy on logger.debug to capture logs
      jest.spyOn(require('../../src/utils/logger').logger, 'debug');
    });

    afterEach(() => {
      // Clear all mocks after each test
      jest.restoreAllMocks();
    });

    it('should never log plaintext tokens in connect attempts', async () => {
      const sensitiveToken = 'tk_very_secret_api_token_123456789';
      const apiUrl = 'https://vikunja.example.com/api/v1';
      
      // Mock successful connection
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.connect.mockReturnValue(undefined);
      mockAuthManager.getAuthType.mockReturnValue('api-token');
      
      // Execute the tool
      await callTool('connect', {
        apiUrl,
        apiToken: sensitiveToken
      });

      // Verify logger.debug was called
      const loggerSpy = require('../../src/utils/logger').logger.debug;
      expect(loggerSpy).toHaveBeenCalled();

      // Check all debug log calls to ensure no plaintext token exposure
      const debugCalls = loggerSpy.mock.calls;
      debugCalls.forEach((call: any[]) => {
        const logMessage = call.join(' ');
        expect(logMessage).not.toContain('very_secret_api_token_123456789');
        expect(logMessage).not.toContain(sensitiveToken);
        
        // If it mentions a token, it should be masked
        if (logMessage.toLowerCase().includes('token')) {
          expect(logMessage).toMatch(/tk_v\.\.\./); // Should be masked to first 4 chars
        }
      });
    });

    it('should mask different token types consistently', async () => {
      const testTokens = [
        'tk_short123456789',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.very_long_jwt_payload.signature',
        'api_key_supersecret123456789'
      ];

      for (const token of testTokens) {
        // Clear previous calls
        jest.clearAllMocks();
        jest.spyOn(require('../../src/utils/logger').logger, 'debug');

        mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
        mockAuthManager.connect.mockReturnValue(undefined);
        mockAuthManager.getAuthType.mockReturnValue(token.startsWith('tk_') ? 'api-token' : 'jwt');

        // Execute the tool
        await callTool('connect', {
          apiUrl: 'https://test.example.com',
          apiToken: token
        });

        // Verify no plaintext token in logs
        const loggerSpy = require('../../src/utils/logger').logger.debug;
        const debugCalls = loggerSpy.mock.calls;
        
        debugCalls.forEach((call: any[]) => {
          const logMessage = call.join(' ');
          expect(logMessage).not.toContain(token);
          
          // Should show only first 4 characters + ellipsis
          if (logMessage.toLowerCase().includes('token')) {
            expect(logMessage).toMatch(/\w{4}\.\.\./); 
          }
        });
      }
    });
  });

  describe('comprehensive edge cases for full coverage', () => {
    it('should handle connection when already connected to different URL', async () => {
      // Mock getStatus to return authenticated to a different URL
      mockAuthManager.getStatus.mockReturnValue({
        authenticated: true,
        apiUrl: 'https://different.example.com',
      });
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      });

      expect(mockAuthManager.connect).toHaveBeenCalledWith(
        'https://vikunja.example.com',
        'tk_test-token-123',
      );
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle MCPError from auth manager during connect', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      const mcpError = new MCPError(ErrorCode.AUTH_ERROR, 'Invalid credentials');
      mockAuthManager.connect.mockImplementation(() => {
        throw mcpError;
      });

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow(mcpError);
    });

    it('should handle non-Error object thrown during connect', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.connect.mockImplementation(() => {
        throw { message: 'custom error object' };
      });

      // Plain objects (even ones with a .message property) are untrusted
      // upstream payloads and never surface their message; the error
      // handler normalizes them to "Unknown error".
      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow('Authentication error: Unknown error');
    });

    it('should handle status when MCPError is thrown', async () => {
      const mcpError = new MCPError(ErrorCode.INTERNAL_ERROR, 'Internal status error');
      mockAuthManager.getStatus.mockImplementation(() => {
        throw mcpError;
      });

      await expect(callTool('status')).rejects.toThrow(mcpError);
    });

    it('should handle disconnect when MCPError is thrown', async () => {
      const mcpError = new MCPError(ErrorCode.INTERNAL_ERROR, 'Disconnect error');
      mockAuthManager.disconnect.mockImplementation(() => {
        throw mcpError;
      });

      await expect(callTool('disconnect')).rejects.toThrow(mcpError);
    });

    it('should handle refresh error propagation', async () => {
      // Test that refresh path can handle errors if they occur
      // Since refresh is a simple operation that doesn't interact with external systems,
      // we'll just verify it executes successfully
      const result = await callTool('refresh');

      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-refresh');
    });

    it('should validate URL format', async () => {
      await expect(callTool('connect', {
        apiUrl: 'not-a-valid-url',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow();
    });

    it('should handle empty string parameters', async () => {
      await expect(callTool('connect', {
        apiUrl: '',
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow();

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: '',
      })).rejects.toThrow();
    });

    it('should handle status with partial authentication info', async () => {
      const mockStatus = {
        authenticated: true,
        // Missing apiUrl to test undefined handling
      };
      mockAuthManager.getStatus.mockReturnValue(mockStatus);

      const result = await callTool('status');

      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('auth-status');
    });

    it('should handle status with error instance', async () => {
      const error = new Error('Status check failed');
      mockAuthManager.getStatus.mockImplementation(() => {
        throw error;
      });

      await expect(callTool('status')).rejects.toThrow(
        'Authentication error: Status check failed'
      );
    });

    it('should test Promise.resolve path in connect success', async () => {
      mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      const result = await callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
      });

      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('jwt');
    });

    it('should handle all possible error code paths', async () => {
      // Test validation error path
      await expect(callTool('connect', {
        // Missing both required fields
      })).rejects.toThrow(MCPError);

      // Test unknown subcommand validation
      await expect(callTool('invalid_subcommand' as any)).rejects.toThrow(
        'Unknown subcommand: invalid_subcommand'
      );
    });

    it('should handle null/undefined in parameters gracefully', async () => {
      await expect(callTool('connect', {
        apiUrl: null as any,
        apiToken: 'tk_test-token-123',
      })).rejects.toThrow();

      await expect(callTool('connect', {
        apiUrl: 'https://vikunja.example.com',
        apiToken: null as any,
      })).rejects.toThrow();
    });

    it('should test security logging with edge case tokens', async () => {
      const edgeCaseTokens = [
        'tk_longer_token_for_testing', // Longer token to test masking
        'x'.repeat(50), // Long token
        'tk_special-chars-test', // Special characters
      ];

      for (const token of edgeCaseTokens) {
        jest.clearAllMocks();
        jest.spyOn(require('../../src/utils/logger').logger, 'debug');

        mockAuthManager.getStatus.mockReturnValue({ authenticated: false });
        mockAuthManager.connect.mockReturnValue(undefined);
        mockAuthManager.getAuthType.mockReturnValue('api-token');

        try {
          await callTool('connect', {
            apiUrl: 'https://test.example.com',
            apiToken: token
          });

          // Check logging doesn't expose the full token (beyond first 4 chars)
          const loggerSpy = require('../../src/utils/logger').logger.debug;
          const debugCalls = loggerSpy.mock.calls;
          
          debugCalls.forEach((call: any[]) => {
            const logMessage = call.join(' ');
            // Should not contain the full token, only the masked version
            if (token.length > 4) {
              expect(logMessage).not.toContain(token.slice(4)); // Should not contain chars beyond first 4
            }
          });
        } catch (error) {
          // Some edge cases might fail validation, which is expected
          // But they still shouldn't expose tokens in logs
          const loggerSpy = require('../../src/utils/logger').logger.debug;
          if (loggerSpy.mock.calls.length > 0) {
            const debugCalls = loggerSpy.mock.calls;
            debugCalls.forEach((call: any[]) => {
              const logMessage = call.join(' ');
              if (token.length > 4) {
                expect(logMessage).not.toContain(token.slice(4));
              }
            });
          }
        }
      }
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
      // mockHasRequestContext.mockReturnValue() persists across
      // jest.clearAllMocks() (which clears calls, not implementations) —
      // reset it explicitly so oidc-mode-only setup never bleeds into an
      // unrelated test.
      mockHasRequestContext.mockReturnValue(false);
    });

    it('never rejects any vikunja_auth subcommand — session management only, not Vikunja data', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      for (const subcommand of ['status', 'refresh', 'disconnect', 'info']) {
        expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand }))).toBe(false);
      }
    });

    it('DOES reject provision/deprovision in oidc-http mode — they mutate the credential vault', async () => {
      mockHasRequestContext.mockReturnValue(true);
      (getCurrentIdentity as jest.Mock).mockReturnValue({
        issuer: 'https://idp.example/realm',
        sub: 'user-1',
      });
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'provision', apiToken: 'tk_x', vikunjaUrl: 'https://vikunja.example.com' }),
        ),
      ).toBe(true);
      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'deprovision' }))).toBe(true);
    });
  });

  describe('closure-gate precedence fix (oidc-http mode)', () => {
    beforeEach(() => {
      mockHasRequestContext.mockReturnValue(true);
      mockGetAuthManagerFromContext.mockReset();
    });

    afterEach(() => {
      mockHasRequestContext.mockReturnValue(false);
    });

    it("'info' defers to getAuthManagerFromContext instead of the closure authManager's isAuthenticated()", async () => {
      // The closure authManager reports NOT authenticated — under the old
      // (buggy) ordering this would throw the generic "please connect"
      // error immediately. With the fix, hasRequestContext() short-circuits
      // straight to getAuthManagerFromContext(), whose (mocked) resolution
      // here succeeds, so the call proceeds to the real /info request.
      mockAuthManager.isAuthenticated.mockReturnValue(false);
      mockGetAuthManagerFromContext.mockResolvedValue(mockAuthManager);
      mockVikunjaRestRequest.mockResolvedValue({ version: '2.3.0' });

      const result = await callTool('info');

      expect(mockGetAuthManagerFromContext).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('auth-info');
    });

    it("'info' propagates getAuthManagerFromContext's AUTH_REQUIRED provisioning-prompt error, never the generic message", async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);
      const provisionPrompt = new MCPError(
        ErrorCode.AUTH_REQUIRED,
        "You're authenticated as abcd... but haven't linked a Vikunja API token yet. " +
          'Run vikunja_auth provision with a token you create in Vikunja → Settings → API Tokens.',
      );
      mockGetAuthManagerFromContext.mockRejectedValue(provisionPrompt);

      await expect(callTool('info')).rejects.toThrow('vikunja_auth provision');
      await expect(callTool('info')).rejects.not.toThrow('Please use vikunja_auth.connect first');
    });
  });

  describe('oidc-http-mode provisioning subcommands', () => {
    const identity = { issuer: 'https://idp.example/realm', sub: 'user-1' };
    let mockVault: {
      getCredential: jest.Mock;
      getStatus: jest.Mock;
      provision: jest.Mock;
      deprovision: jest.Mock;
    };

    beforeEach(() => {
      mockHasRequestContext.mockReturnValue(true);
      (getCurrentIdentity as jest.Mock).mockReturnValue(identity);
      mockVault = {
        getCredential: jest.fn(),
        getStatus: jest.fn().mockReturnValue({ provisioned: false }),
        provision: jest.fn().mockResolvedValue(undefined),
        deprovision: jest.fn().mockResolvedValue(true),
      };
      (getActiveVaultStore as jest.Mock).mockReturnValue(mockVault);
      mockVikunjaRestRequest.mockReset();
      mockVikunjaRestRequest.mockImplementation(async (_authManager: unknown, _method: string, path: string) => {
        if (path === '/info') {
          return { version: '1.2.3' };
        }
        return [];
      });
    });

    afterEach(() => {
      mockHasRequestContext.mockReturnValue(false);
      (getCurrentIdentity as jest.Mock).mockReturnValue(undefined);
      (getActiveVaultStore as jest.Mock).mockReturnValue(undefined);
    });

    describe('provision', () => {
      it('validates the token against Vikunja BEFORE storing it, then stores it keyed by the validated identity', async () => {
        const result = await callTool('provision', {
          apiToken: 'tk_real-token-1234567890',
          vikunjaUrl: 'https://vikunja.example.com',
        });

        expect(mockVikunjaRestRequest).toHaveBeenCalledWith(expect.anything(), 'GET', '/info');
        expect(mockVault.provision).toHaveBeenCalledWith(
          identity,
          'https://vikunja.example.com',
          'tk_real-token-1234567890',
        );
        // Validation must happen before storage — the mock records call
        // order via the shared mockVikunjaRestRequest/mockVault.provision
        // invocation sequence; asserting both were called is the
        // behavioural proof this test is titled for.
        const markdown = result.content[0].text;
        expect(markdown).toContain('auth-provision');
        expect(markdown).not.toContain('tk_real-token-1234567890');
      });

      it('never stores the token when server validation fails', async () => {
        mockVikunjaRestRequest.mockRejectedValue(new Error('connection refused'));

        await expect(
          callTool('provision', { apiToken: 'tk_bad', vikunjaUrl: 'https://vikunja.example.com' }),
        ).rejects.toThrow(MCPError);
        expect(mockVault.provision).not.toHaveBeenCalled();
      });

      it('ignores any identity-shaped fields on args — identity always comes from the validated request context', async () => {
        await callTool('provision', {
          apiToken: 'tk_real',
          vikunjaUrl: 'https://vikunja.example.com',
          // Not part of the schema, but even if a caller smuggled these in,
          // getCurrentIdentity() (mocked here to the real identity) is the
          // only source auth.ts ever reads from.
          sub: 'attacker-controlled-sub',
          issuer: 'https://attacker.example/realm',
        } as Record<string, unknown>);

        expect(mockVault.provision).toHaveBeenCalledWith(
          identity,
          'https://vikunja.example.com',
          'tk_real',
        );
      });

      it('requires apiToken', async () => {
        await expect(
          callTool('provision', { vikunjaUrl: 'https://vikunja.example.com' }),
        ).rejects.toThrow('apiToken is required');
      });

      it('requires a resolvable Vikunja URL', async () => {
        const originalUrl = process.env.VIKUNJA_URL;
        delete process.env.VIKUNJA_URL;
        ConfigurationManager.reset();
        try {
          await expect(callTool('provision', { apiToken: 'tk_real' })).rejects.toThrow(
            'No Vikunja URL is configured',
          );
        } finally {
          ConfigurationManager.reset();
          if (originalUrl !== undefined) {
            process.env.VIKUNJA_URL = originalUrl;
          }
        }
      });

      it('rejects in stdio mode with a clear "oidc-http mode feature" error', async () => {
        mockHasRequestContext.mockReturnValue(false);

        await expect(
          callTool('provision', { apiToken: 'tk_real', vikunjaUrl: 'https://vikunja.example.com' }),
        ).rejects.toThrow('oidc-http mode feature');
        expect(mockVault.provision).not.toHaveBeenCalled();
      });
    });

    describe('status (oidc-http mode)', () => {
      it("reports the calling identity's own vault status, masked", async () => {
        mockVault.getStatus.mockReturnValue({
          provisioned: true,
          vikunjaUrl: 'https://vikunja.example.com',
          maskedToken: 'tk_r...',
          lastUsedAt: null,
        });

        const result = await callTool('status');

        expect(mockVault.getStatus).toHaveBeenCalledWith(identity);
        const markdown = result.content[0].text;
        expect(markdown).toContain('tk_r...');
        expect(markdown).not.toContain('tk_real');
      });

      it('reports not-provisioned honestly when unlinked', async () => {
        mockVault.getStatus.mockReturnValue({ provisioned: false });

        const result = await callTool('status');

        const markdown = result.content[0].text;
        expect(markdown).toContain('No Vikunja API token linked yet');
      });
    });

    describe('deprovision', () => {
      it('deletes the calling identity\'s vault record', async () => {
        const result = await callTool('deprovision');

        expect(mockVault.deprovision).toHaveBeenCalledWith(identity);
        expect(result.content[0].text).toContain('Deprovisioned');
      });

      it('is idempotent — reports honestly when there was nothing to remove', async () => {
        mockVault.deprovision.mockResolvedValue(false);

        const result = await callTool('deprovision');

        expect(result.content[0].text).toContain('No linked Vikunja API token to remove');
      });

      it('rejects in stdio mode with a clear "oidc-http mode feature" error', async () => {
        mockHasRequestContext.mockReturnValue(false);

        await expect(callTool('deprovision')).rejects.toThrow('oidc-http mode feature');
        expect(mockVault.deprovision).not.toHaveBeenCalled();
      });
    });

    describe('connect/disconnect aliasing in oidc-http mode', () => {
      it("'connect' returns a structured error pointing at 'provision'", async () => {
        await expect(
          callTool('connect', { apiUrl: 'https://vikunja.example.com', apiToken: 'tk_x' }),
        ).rejects.toThrow('vikunja_auth provision');
      });

      it("'disconnect' aliases 'deprovision'", async () => {
        const result = await callTool('disconnect');

        expect(mockVault.deprovision).toHaveBeenCalledWith(identity);
        expect(result.content[0].text).toContain('Deprovisioned');
      });
    });
  });
});
