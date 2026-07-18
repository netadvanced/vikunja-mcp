/**
 * Tests for tool registration
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerTools } from '../../src/tools';
import { ConfigurationManager } from '../../src/config';
import { logger } from '../../src/utils/logger';

// Mock all tool registration functions
jest.mock('../../src/tools/auth', () => ({
  registerAuthTool: jest.fn(),
}));

jest.mock('../../src/tools/tasks', () => ({
  registerTasksTool: jest.fn(),
}));

jest.mock('../../src/tools/projects/index', () => ({
  registerProjectsTool: jest.fn(),
}));

jest.mock('../../src/tools/labels', () => ({
  registerLabelsTool: jest.fn(),
}));

jest.mock('../../src/tools/teams', () => ({
  registerTeamsTool: jest.fn(),
}));

jest.mock('../../src/tools/users', () => ({
  registerUsersTool: jest.fn(),
}));

jest.mock('../../src/tools/filters', () => ({
  registerFiltersTool: jest.fn(),
}));

jest.mock('../../src/tools/templates', () => ({
  registerTemplatesTool: jest.fn(),
}));

jest.mock('../../src/tools/webhooks', () => ({
  registerWebhooksTool: jest.fn(),
}));

jest.mock('../../src/tools/batch-import', () => ({
  registerBatchImportTool: jest.fn(),
}));

jest.mock('../../src/tools/export', () => ({
  registerExportTool: jest.fn(),
}));

jest.mock('../../src/tools/notifications', () => ({
  registerNotificationsTool: jest.fn(),
}));

jest.mock('../../src/tools/subscriptions', () => ({
  registerSubscriptionsTool: jest.fn(),
}));

jest.mock('../../src/tools/reactions', () => ({
  registerReactionsTool: jest.fn(),
}));

jest.mock('../../src/tools/tokens', () => ({
  registerTokensTool: jest.fn(),
}));

jest.mock('../../src/tools/caldav-tokens', () => ({
  registerCaldavTokensTool: jest.fn(),
}));

jest.mock('../../src/tools/admin', () => ({
  registerAdminTool: jest.fn(),
}));

// Import mocked functions
import { registerAuthTool } from '../../src/tools/auth';
import { registerTasksTool } from '../../src/tools/tasks';
import { registerProjectsTool } from '../../src/tools/projects/index';
import { registerLabelsTool } from '../../src/tools/labels';
import { registerTeamsTool } from '../../src/tools/teams';
import { registerUsersTool } from '../../src/tools/users';
import { registerFiltersTool } from '../../src/tools/filters';
import { registerTemplatesTool } from '../../src/tools/templates';
import { registerWebhooksTool } from '../../src/tools/webhooks';
import { registerBatchImportTool } from '../../src/tools/batch-import';
import { registerExportTool } from '../../src/tools/export';
import { registerNotificationsTool } from '../../src/tools/notifications';
import { registerSubscriptionsTool } from '../../src/tools/subscriptions';
import { registerReactionsTool } from '../../src/tools/reactions';
import { registerTokensTool } from '../../src/tools/tokens';
import { registerCaldavTokensTool } from '../../src/tools/caldav-tokens';
import { registerAdminTool } from '../../src/tools/admin';

describe('Tool Registration', () => {
  let mockServer: jest.Mocked<McpServer>;
  let mockAuthManager: jest.Mocked<AuthManager>;
  let originalEnv: NodeJS.ProcessEnv;

  const MODULE_ENV_VARS = [
    'VIKUNJA_MCP_CONFIG',
    'VIKUNJA_MCP_MODULE_TASKS',
    'VIKUNJA_MCP_MODULE_PROJECTS',
    'VIKUNJA_MCP_MODULE_LABELS',
    'VIKUNJA_MCP_MODULE_TEAMS',
    'VIKUNJA_MCP_MODULE_USERS',
    'VIKUNJA_MCP_MODULE_WEBHOOKS',
    'VIKUNJA_MCP_MODULE_FILTERS',
    'VIKUNJA_MCP_MODULE_TEMPLATES',
    'VIKUNJA_MCP_MODULE_EXPORT',
    'VIKUNJA_MCP_MODULE_BATCH_IMPORT',
    'VIKUNJA_MCP_MODULE_NOTIFICATIONS',
    'VIKUNJA_MCP_MODULE_SUBSCRIPTIONS',
    'VIKUNJA_MCP_MODULE_REACTIONS',
    'VIKUNJA_MCP_MODULE_ADMIN',
    'VIKUNJA_MCP_MODULE_USER_DELETION',
    'VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT',
    'VIKUNJA_MCP_MODULE_CALDAV_TOKENS',
  ];

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of MODULE_ENV_VARS) {
      delete process.env[key];
    }
    // Ensure module gating reads a fresh config on every test rather than a
    // config cached (and possibly stale) from a previous test in this file.
    ConfigurationManager.reset();

    // Create mock instances
    mockServer = {
      tool: jest.fn(),
    } as any;

    mockAuthManager = {
      isAuthenticated: jest.fn(),
      getAuthType: jest.fn(),
    } as any;

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    ConfigurationManager.reset();
  });

  describe('registerTools', () => {
    it('should register auth and tasks tools without clientFactory', () => {
      // Arrange - test without clientFactory (only auth and tasks tools registered)
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      // Act
      registerTools(mockServer, mockAuthManager, undefined);

      // Assert - verify only auth and tasks tools are registered when no clientFactory
      expect(registerAuthTool).toHaveBeenCalledTimes(1);
      expect(registerAuthTool).toHaveBeenCalledWith(mockServer, mockAuthManager);

      expect(registerTasksTool).toHaveBeenCalledTimes(1);
      expect(registerTasksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, undefined);

      // These should NOT be called without clientFactory
      expect(registerProjectsTool).not.toHaveBeenCalled();
      expect(registerLabelsTool).not.toHaveBeenCalled();
      expect(registerTeamsTool).not.toHaveBeenCalled();
      expect(registerFiltersTool).not.toHaveBeenCalled();
      expect(registerTemplatesTool).not.toHaveBeenCalled();
      expect(registerWebhooksTool).not.toHaveBeenCalled();
      expect(registerBatchImportTool).not.toHaveBeenCalled();
      expect(registerUsersTool).not.toHaveBeenCalled();
      expect(registerExportTool).not.toHaveBeenCalled();
      expect(registerNotificationsTool).not.toHaveBeenCalled();
      expect(registerSubscriptionsTool).not.toHaveBeenCalled();
      expect(registerReactionsTool).not.toHaveBeenCalled();
    });

    it('should register all tools except users and export when using API token auth with clientFactory', () => {
      // Arrange - test with API token auth and clientFactory
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      // Act
      registerTools(mockServer, mockAuthManager, mockClientFactory);

      // Assert - verify all tools except users and export are registered
      expect(registerAuthTool).toHaveBeenCalledTimes(1);
      expect(registerAuthTool).toHaveBeenCalledWith(mockServer, mockAuthManager);

      expect(registerTasksTool).toHaveBeenCalledTimes(1);
      expect(registerTasksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerProjectsTool).toHaveBeenCalledTimes(1);
      expect(registerProjectsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerLabelsTool).toHaveBeenCalledTimes(1);
      expect(registerLabelsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerTeamsTool).toHaveBeenCalledTimes(1);
      expect(registerTeamsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerFiltersTool).toHaveBeenCalledTimes(1);
      expect(registerFiltersTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerTemplatesTool).toHaveBeenCalledTimes(1);
      expect(registerTemplatesTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerWebhooksTool).toHaveBeenCalledTimes(1);
      expect(registerWebhooksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerBatchImportTool).toHaveBeenCalledTimes(1);
      expect(registerBatchImportTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerNotificationsTool).toHaveBeenCalledTimes(1);
      expect(registerNotificationsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerSubscriptionsTool).toHaveBeenCalledTimes(1);
      expect(registerSubscriptionsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerReactionsTool).toHaveBeenCalledTimes(1);
      expect(registerReactionsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      // These should NOT be called with API token auth (backward compatibility)
      expect(registerUsersTool).not.toHaveBeenCalled();
      expect(registerExportTool).not.toHaveBeenCalled();
    });

    it('should register all tools including users and export when using JWT auth with clientFactory', () => {
      // Arrange - test with JWT auth and clientFactory
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      // Act
      registerTools(mockServer, mockAuthManager, mockClientFactory);

      // Assert - verify all tools are registered
      expect(registerAuthTool).toHaveBeenCalledTimes(1);
      expect(registerAuthTool).toHaveBeenCalledWith(mockServer, mockAuthManager);

      expect(registerTasksTool).toHaveBeenCalledTimes(1);
      expect(registerTasksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerProjectsTool).toHaveBeenCalledTimes(1);
      expect(registerProjectsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerLabelsTool).toHaveBeenCalledTimes(1);
      expect(registerLabelsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerTeamsTool).toHaveBeenCalledTimes(1);
      expect(registerTeamsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerFiltersTool).toHaveBeenCalledTimes(1);
      expect(registerFiltersTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerTemplatesTool).toHaveBeenCalledTimes(1);
      expect(registerTemplatesTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerWebhooksTool).toHaveBeenCalledTimes(1);
      expect(registerWebhooksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerBatchImportTool).toHaveBeenCalledTimes(1);
      expect(registerBatchImportTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerNotificationsTool).toHaveBeenCalledTimes(1);
      expect(registerNotificationsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerSubscriptionsTool).toHaveBeenCalledTimes(1);
      expect(registerSubscriptionsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerReactionsTool).toHaveBeenCalledTimes(1);
      expect(registerReactionsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      // These SHOULD be called with JWT auth
      expect(registerUsersTool).toHaveBeenCalledTimes(1);
      expect(registerUsersTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);
      expect(registerExportTool).toHaveBeenCalledTimes(1);
      expect(registerExportTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);
    });

    it('should not register users and export tools when not authenticated with clientFactory', () => {
      // Arrange
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      // Act
      registerTools(mockServer, mockAuthManager, mockClientFactory);

      // Assert - other tools are registered but not users/export (backward compatibility)
      expect(registerAuthTool).toHaveBeenCalledTimes(1);
      expect(registerAuthTool).toHaveBeenCalledWith(mockServer, mockAuthManager);

      expect(registerTasksTool).toHaveBeenCalledTimes(1);
      expect(registerTasksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerProjectsTool).toHaveBeenCalledTimes(1);
      expect(registerProjectsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerLabelsTool).toHaveBeenCalledTimes(1);
      expect(registerLabelsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerTeamsTool).toHaveBeenCalledTimes(1);
      expect(registerTeamsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerFiltersTool).toHaveBeenCalledTimes(1);
      expect(registerFiltersTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerTemplatesTool).toHaveBeenCalledTimes(1);
      expect(registerTemplatesTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerWebhooksTool).toHaveBeenCalledTimes(1);
      expect(registerWebhooksTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerBatchImportTool).toHaveBeenCalledTimes(1);
      expect(registerBatchImportTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerNotificationsTool).toHaveBeenCalledTimes(1);
      expect(registerNotificationsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerSubscriptionsTool).toHaveBeenCalledTimes(1);
      expect(registerSubscriptionsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      expect(registerReactionsTool).toHaveBeenCalledTimes(1);
      expect(registerReactionsTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);

      // These should NOT be called when not authenticated
      expect(registerUsersTool).not.toHaveBeenCalled();
      expect(registerExportTool).not.toHaveBeenCalled();
    });

    it('should register tools in the correct order with JWT auth and clientFactory', () => {
      // Arrange
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      // Act
      registerTools(mockServer, mockAuthManager, mockClientFactory);

      // Assert - verify order by checking mock invocation order
      const callOrder = [
        (registerAuthTool as jest.Mock).mock.invocationCallOrder[0],
        (registerTasksTool as jest.Mock).mock.invocationCallOrder[0],
        (registerProjectsTool as jest.Mock).mock.invocationCallOrder[0],
        (registerLabelsTool as jest.Mock).mock.invocationCallOrder[0],
        (registerTeamsTool as jest.Mock).mock.invocationCallOrder[0],
        (registerFiltersTool as jest.Mock).mock.invocationCallOrder[0],
        (registerTemplatesTool as jest.Mock).mock.invocationCallOrder[0],
        (registerWebhooksTool as jest.Mock).mock.invocationCallOrder[0],
        (registerBatchImportTool as jest.Mock).mock.invocationCallOrder[0],
        (registerNotificationsTool as jest.Mock).mock.invocationCallOrder[0],
        (registerSubscriptionsTool as jest.Mock).mock.invocationCallOrder[0],
        (registerReactionsTool as jest.Mock).mock.invocationCallOrder[0],
        (registerUsersTool as jest.Mock).mock.invocationCallOrder[0],
        (registerExportTool as jest.Mock).mock.invocationCallOrder[0],
      ];

      // Verify that each function was called in sequence
      for (let i = 1; i < callOrder.length; i++) {
        expect(callOrder[i]).toBeGreaterThan(callOrder[i - 1]);
      }
    });
  });

  describe('Module Gating', () => {
    it('should not register the tasks tool family when the tasks module is disabled', () => {
      process.env.VIKUNJA_MCP_MODULE_TASKS = 'false';
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      registerTools(mockServer, mockAuthManager, undefined);

      expect(registerTasksTool).not.toHaveBeenCalled();
      // registerAuthTool is unconditional
      expect(registerAuthTool).toHaveBeenCalledTimes(1);
    });

    it('should not register a disabled module tool (projects) while other modules stay registered', () => {
      process.env.VIKUNJA_MCP_MODULE_PROJECTS = 'false';
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      expect(registerProjectsTool).not.toHaveBeenCalled();
      expect(registerLabelsTool).toHaveBeenCalledTimes(1);
      expect(registerTeamsTool).toHaveBeenCalledTimes(1);
    });

    it('should not register webhooks/filters/templates/batch-import tools when disabled', () => {
      process.env.VIKUNJA_MCP_MODULE_WEBHOOKS = 'false';
      process.env.VIKUNJA_MCP_MODULE_FILTERS = 'false';
      process.env.VIKUNJA_MCP_MODULE_TEMPLATES = 'false';
      process.env.VIKUNJA_MCP_MODULE_BATCH_IMPORT = 'false';
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      expect(registerWebhooksTool).not.toHaveBeenCalled();
      expect(registerFiltersTool).not.toHaveBeenCalled();
      expect(registerTemplatesTool).not.toHaveBeenCalled();
      expect(registerBatchImportTool).not.toHaveBeenCalled();
      // Untouched modules are still registered
      expect(registerProjectsTool).toHaveBeenCalledTimes(1);
    });

    it('should not register notifications/subscriptions/reactions tools when disabled', () => {
      process.env.VIKUNJA_MCP_MODULE_NOTIFICATIONS = 'false';
      process.env.VIKUNJA_MCP_MODULE_SUBSCRIPTIONS = 'false';
      process.env.VIKUNJA_MCP_MODULE_REACTIONS = 'false';
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      expect(registerNotificationsTool).not.toHaveBeenCalled();
      expect(registerSubscriptionsTool).not.toHaveBeenCalled();
      expect(registerReactionsTool).not.toHaveBeenCalled();
      // Untouched modules are still registered
      expect(registerWebhooksTool).toHaveBeenCalledTimes(1);
    });

    it('should register notifications/subscriptions/reactions tools with API-token auth (not JWT-gated)', () => {
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      expect(registerNotificationsTool).toHaveBeenCalledTimes(1);
      expect(registerSubscriptionsTool).toHaveBeenCalledTimes(1);
      expect(registerReactionsTool).toHaveBeenCalledTimes(1);
    });

    it('should register users/export tools when JWT-authenticated and their modules stay enabled by default', () => {
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      expect(registerUsersTool).toHaveBeenCalledTimes(1);
      expect(registerExportTool).toHaveBeenCalledTimes(1);
    });

    it('should not register the export tool when its module is disabled, even with JWT auth', () => {
      process.env.VIKUNJA_MCP_MODULE_EXPORT = 'false';
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      expect(registerExportTool).not.toHaveBeenCalled();
      // Users module untouched — still registered
      expect(registerUsersTool).toHaveBeenCalledTimes(1);
    });

    it('should NARROW but never EXPAND auth: enabling the users module cannot grant access under API-token auth', () => {
      process.env.VIKUNJA_MCP_MODULE_USERS = 'true';
      process.env.VIKUNJA_MCP_MODULE_EXPORT = 'true';
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('api-token');

      registerTools(mockServer, mockAuthManager, mockClientFactory);

      // Auth type still forbids these tools regardless of module config
      expect(registerUsersTool).not.toHaveBeenCalled();
      expect(registerExportTool).not.toHaveBeenCalled();
    });

    it('should keep userDeletion unregistered by default (no tool wired to it yet)', () => {
      // No VIKUNJA_MCP_MODULE_USER_DELETION set — defaults apply
      // (deny-by-default). There is currently no registration function for
      // this reserved module; this test documents that registerTools
      // succeeds without attempting to register anything for it.
      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      expect(() => registerTools(mockServer, mockAuthManager, mockClientFactory)).not.toThrow();
    });

    describe('tokenManagement module (deny-by-default)', () => {
      it('should NOT register vikunja_tokens by default', () => {
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerTokensTool).not.toHaveBeenCalled();
      });

      it('should register vikunja_tokens when explicitly enabled with JWT auth', () => {
        process.env.VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerTokensTool).toHaveBeenCalledTimes(1);
        expect(registerTokensTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);
      });

      it('should register vikunja_tokens when explicitly enabled with API-token auth (not JWT-gated)', () => {
        process.env.VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('api-token');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerTokensTool).toHaveBeenCalledTimes(1);
      });

      it('should not register vikunja_tokens without a clientFactory even when enabled', () => {
        process.env.VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT = 'true';
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, undefined);

        expect(registerTokensTool).not.toHaveBeenCalled();
      });
    });

    describe('caldavTokens module (deny-by-default + JWT-only)', () => {
      it('should NOT register vikunja_caldav_tokens by default', () => {
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerCaldavTokensTool).not.toHaveBeenCalled();
      });

      it('should register vikunja_caldav_tokens when enabled AND JWT-authenticated', () => {
        process.env.VIKUNJA_MCP_MODULE_CALDAV_TOKENS = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerCaldavTokensTool).toHaveBeenCalledTimes(1);
        expect(registerCaldavTokensTool).toHaveBeenCalledWith(
          mockServer,
          mockAuthManager,
          mockClientFactory,
        );
      });

      it('should stay unregistered when enabled but authenticated with an API token (config narrows auth, never expands it)', () => {
        process.env.VIKUNJA_MCP_MODULE_CALDAV_TOKENS = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('api-token');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerCaldavTokensTool).not.toHaveBeenCalled();
      });

      it('should stay unregistered when JWT-authenticated but the module is left at its default (off)', () => {
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerCaldavTokensTool).not.toHaveBeenCalled();
      });

      it('should stay unregistered when enabled but not authenticated at all', () => {
        process.env.VIKUNJA_MCP_MODULE_CALDAV_TOKENS = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(false);

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerCaldavTokensTool).not.toHaveBeenCalled();
      });

      it('should not register vikunja_caldav_tokens without a clientFactory even when enabled', () => {
        process.env.VIKUNJA_MCP_MODULE_CALDAV_TOKENS = 'true';
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, undefined);

        expect(registerCaldavTokensTool).not.toHaveBeenCalled();
      });
    });

    describe('admin module (deny-by-default + JWT-only)', () => {
      it('should NOT register vikunja_admin by default', () => {
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerAdminTool).not.toHaveBeenCalled();
      });

      it('should register vikunja_admin when enabled AND JWT-authenticated', () => {
        process.env.VIKUNJA_MCP_MODULE_ADMIN = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerAdminTool).toHaveBeenCalledTimes(1);
        expect(registerAdminTool).toHaveBeenCalledWith(mockServer, mockAuthManager, mockClientFactory);
      });

      it('should stay unregistered when enabled but authenticated with an API token (config narrows auth, never expands it)', () => {
        process.env.VIKUNJA_MCP_MODULE_ADMIN = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('api-token');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerAdminTool).not.toHaveBeenCalled();
      });

      it('should stay unregistered when JWT-authenticated but the module is left at its default (off)', () => {
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(true);
        mockAuthManager.getAuthType.mockReturnValue('jwt');

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerAdminTool).not.toHaveBeenCalled();
      });

      it('should stay unregistered when enabled but not authenticated at all', () => {
        process.env.VIKUNJA_MCP_MODULE_ADMIN = 'true';
        const mockClientFactory = { test: 'factory' };
        mockAuthManager.isAuthenticated.mockReturnValue(false);

        registerTools(mockServer, mockAuthManager, mockClientFactory);

        expect(registerAdminTool).not.toHaveBeenCalled();
      });
    });

    it('should fail safe to default module gating (and log clearly) when config loading throws', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-mcp-tools-index-test-'));
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, '{ not valid json');
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      const mockClientFactory = { test: 'factory' };
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockAuthManager.getAuthType.mockReturnValue('jwt');

      expect(() => registerTools(mockServer, mockAuthManager, mockClientFactory)).not.toThrow();

      // Falls back to defaults: ordinary modules stay registered
      expect(registerProjectsTool).toHaveBeenCalledTimes(1);
      expect(registerTasksTool).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load module gating configuration'),
        expect.anything()
      );

      errorSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
